import type { ShirabeCandidate, ShirabeWord } from '~/utils/wordCard';
// Defined beside the tokens that produce it: assembling one by hand is exactly
// the mistake the named type exists to prevent.
import type { WordRef } from '~/utils/tokenEnrichment';

export type { WordRef };

/**
 * One shared cache of Shirabe word lookups for the whole page.
 *
 * This used to be a `Map` declared inside `SegmentTokenText`'s `<script setup>`,
 * which runs per component instance -- and there is one instance per segment. So
 * the same word on three results was three private caches and three requests,
 * which is exactly what a reader sees when they check the same word in a few
 * sentences. Living in a module, one entry serves every segment on the page.
 *
 * The cache holds the PROMISE, not the resolved word. A page of twenty segments
 * asking about the same word in the same tick would otherwise all miss (nothing
 * has resolved yet) and each fire its own request; keyed on the promise, the
 * first asker makes the request and the rest await it. That matters more now
 * that hovering prefetches, since a pointer crossing a sentence can start
 * several lookups in quick succession.
 *
 * A word with no entry is cached like any other answer: it is a normal thing for
 * the dictionary to say, and asking again on every hover would spend a request
 * each time to be told it again. A lookup that FAILED is not cached, which is a
 * distinction the catch below explains. The server route sets a day-long
 * `cache-control`, so a reload is still served from the HTTP cache rather than
 * from Shirabe.
 *
 * TWO caches, because there are two questions and they are keyed differently.
 * Which words a token could be is keyed by the token (a lemma read one way is a
 * different question from the same lemma read another); the detail of one of
 * those words is keyed by its SLUG, so every token in the corpus that resolves
 * to 食べる shares one entry.
 */

/**
 * What a candidate lookup came back with.
 *
 * The two empty answers are kept apart because the card now says which one it
 * got. "There is no entry" is a fact about the WORD -- a name, a coinage, a
 * spelling the corpus preserved -- and worth telling the reader, since it is the
 * end of the search rather than a hitch in it. "We could not ask" is a fact
 * about us, and printing it as the dictionary's verdict would be a lie about a
 * word that may well be in there.
 */
export type WordLookup =
  | { candidates: ShirabeCandidate[]; reason?: undefined }
  | { candidates: []; reason: 'missing' | 'failed' };

const inFlight = new Map<string, Promise<WordLookup>>();
const detailInFlight = new Map<string, Promise<ShirabeWord | null>>();

/**
 * Keyed by label language as well as by the token, because Shirabe resolves tag
 * labels into a single language and that is the one thing about the response
 * that varies by reader.
 *
 * Worth keeping even though the card now writes its own part-of-speech and misc
 * chips (`~/utils/wordTagLabels`): the field and dialect tags have no Legend
 * entry to translate from, so they still print Shirabe's label, and it really is
 * translated -- `food` comes back "food, cooking" in English and "gastronomía"
 * in Spanish. Dropping the parameter would put those chips, and every chip's
 * full-wording tooltip, back into English for Spanish readers.
 *
 * It costs less than it looks. A reader's locale is fixed for their session, so
 * no browser ever holds two copies of a word: only the shared caches (ours at
 * the edge, Shirabe's) carry a variant per language, which is what shared caches
 * are for.
 */
function cacheKey(ref: WordRef, locale: string): string {
  return `${ref.lemma}\u0000${ref.surface}\u0000${ref.reading}\u0000${ref.pos}:${locale}`;
}

/** The detail cache's key. A slug already names one word exactly, so unlike
 *  `cacheKey` there is no tuple to assemble -- only the label language. */
function detailKey(id: string, locale: string): string {
  return `${id}:${locale}`;
}

/** The answers we already have. Separate from `inFlight` because a caller needs
 *  to distinguish "answered, and it was nothing" from "never asked"
 *  (undefined), which a promise map cannot express. */
const resolved = new Map<string, WordLookup>();
const resolvedDetail = new Map<string, ShirabeWord | null>();

/**
 * How many answers to keep.
 *
 * This map used to grow for the life of the tab. That is fine for one page and
 * not fine for the session it is actually used in: a reader working through
 * searches hovers a few hundred distinct words an hour, each a parsed word
 * detail of a few KB, and nothing ever dropped one. An evening of study was tens
 * of megabytes of dictionary nobody was looking at any more.
 *
 * Evicting costs almost nothing, which is what makes the bound safe. The server
 * route sets a day-long `cache-control`, so a word that falls out of here is
 * still answered by the browser's own cache without troubling Shirabe -- the
 * reader pays a cache hit, not a round trip.
 */
const CACHE_LIMIT = 600;

/** Look up an answer and mark it as freshly used. A `Map` iterates in insertion
 *  order, so re-inserting moves an entry to the back and leaves the least
 *  recently used at the front, where `remember` evicts from. */
function recall<T>(store: Map<string, T>, key: string): T | undefined {
  const answer = store.get(key);
  if (answer === undefined) return undefined;
  store.delete(key);
  store.set(key, answer);
  return answer;
}

function remember<T>(store: Map<string, T>, key: string, answer: T): T {
  store.delete(key);
  store.set(key, answer);

  if (store.size > CACHE_LIMIT) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  return answer;
}

/** The answer if it is already here, so a card can open filled in rather than
 *  flashing a loading state for a word the page has seen. `undefined` means it
 *  has not been asked. */
export function peekWord(ref: WordRef, locale: string): WordLookup | undefined {
  return recall(resolved, cacheKey(ref, locale));
}

/** The same, for the detail behind one candidate. `null` is a real answer here
 *  (the slug no longer resolves), `undefined` means nobody has asked. */
export function peekWordDetail(id: string, locale: string): ShirabeWord | null | undefined {
  return recall(resolvedDetail, detailKey(id, locale));
}

/**
 * Which words this token could be, ranked, from cache when we have it.
 *
 * Never rejects. An empty answer comes back as a `reason` rather than as a
 * throw, because both kinds of empty are ordinary here and every caller has to
 * handle them anyway -- rejecting would mean each one repeating the same catch
 * to arrive at the same two cases.
 */
export function fetchWord(ref: WordRef, locale: string): Promise<WordLookup> {
  const key = cacheKey(ref, locale);

  const answered = recall(resolved, key);
  if (answered) return Promise.resolve(answered);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<{ candidates: ShirabeCandidate[] }>(
    `/api/shirabe/words/candidates/${encodeURIComponent(ref.lemma)}`,
    {
      query: { locale, surface: ref.surface, reading: ref.reading, pos: ref.pos },
      // The server route already bounds its own calls (1.5s direct, 5s public), so
      // anything past this is not the dictionary being slow -- it is a request
      // that is never coming back, and without a bound the card waits on it
      // forever. Giving up at least lets the card fall back to what the token
      // itself knows.
      timeout: 8000,
    },
  )
    .then((answer): WordLookup => {
      const found = answer?.candidates ?? [];
      // An empty list is the same answer as the 404 below, and has to carry the
      // same reason. The server route turns identify's `words: [null]` into a
      // 404, so this is the belt to that braces -- but without it a response
      // that arrives empty reads as a successful lookup with no reason, and the
      // card reports an `undefined` outcome rather than "no entry".
      if (found.length === 0) return remember(resolved, key, { candidates: [], reason: 'missing' });
      return remember(resolved, key, { candidates: found });
    })
    .catch((error: unknown): WordLookup => {
      // 404 is the server route saying Shirabe resolved this token to nothing.
      // Anything else -- a 502 from a dictionary that would not answer, a
      // request that timed out -- is about the trip rather than the word.
      //
      // Both places ofetch puts the status, because reading only one and finding
      // it undefined would file a plain "no entry" under "could not ask", and
      // the card would go quiet on the answer it most often has to give.
      const failure = error as { response?: { status?: number }; statusCode?: number };
      const status = failure?.response?.status ?? failure?.statusCode;

      // A 404 is an answer and is worth keeping: this word has no entry today
      // and will have none on the next hover either.
      if (status === 404) return remember(resolved, key, { candidates: [], reason: 'missing' });

      // A failure is NOT an answer, and caching it was a bug worth the paragraph.
      // The old code stored every empty result alike, from back when the card
      // could not tell them apart. The effect is that one bad moment -- a
      // dictionary restarting, a dropped connection, a request that timed out --
      // pins that word blank for the rest of the session, and the only way back
      // is a page reload. It is exactly what happened while this was being
      // tested against a local Shirabe that was still warming up: the word
      // stayed empty long after the service was answering perfectly well.
      //
      // Left uncached, the next hover simply asks again and the word fills in.
      // The cost of being wrong here is one request; the cost of the other
      // choice is a word the reader cannot recover without reloading.
      return { candidates: [], reason: 'failed' };
    })
    .finally(() => {
      // Only the in-flight entry is cleared; `resolved` keeps the answer.
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

/**
 * The full detail of one candidate: pitch, badges and dictionary-aligned ruby.
 *
 * Never rejects either, and for a smaller reason than above: the card is already
 * readable without any of this. A slug that no longer resolves, or a dictionary
 * that would not answer, leaves the reader with the headword, the reading and
 * the definitions the candidate already carried -- so `null` is a shrug rather
 * than a state anything has to render.
 *
 * `null` IS cached, unlike a failed candidate lookup. A slug that does not
 * resolve will not start resolving on the next hover, and re-asking would spend
 * a request per open to be told the same thing.
 */
export function fetchWordDetail(id: string, locale: string): Promise<ShirabeWord | null> {
  const key = detailKey(id, locale);

  const answered = recall(resolvedDetail, key);
  if (answered !== undefined) return Promise.resolve(answered);

  const pending = detailInFlight.get(key);
  if (pending) return pending;

  const request = $fetch<ShirabeWord>(`/api/shirabe/words/detail/${encodeURIComponent(id)}`, {
    query: { locale },
    timeout: 8000,
  })
    .then((word) => remember(resolvedDetail, key, word))
    .catch((error: unknown) => {
      const failure = error as { response?: { status?: number }; statusCode?: number };
      const status = failure?.response?.status ?? failure?.statusCode;

      // Same split as above, for the same reason: a slug with no entry is an
      // answer worth keeping, a trip that failed is not.
      if (status === 404) return remember(resolvedDetail, key, null);
      return null;
    })
    .finally(() => {
      detailInFlight.delete(key);
    });

  detailInFlight.set(key, request);
  return request;
}

// `cacheKey` decides which two questions are the same question, and getting that
// wrong is silent in both directions: too loose and two homographs share one
// answer, too tight and every card refetches a word the page already has.
// `CACHE_LIMIT` is here so the eviction test can fill the map exactly to its
// edge rather than hardcoding 600 in two places and silently testing nothing
// the day the bound changes.
export const __testing = { cacheKey, detailKey, CACHE_LIMIT };
