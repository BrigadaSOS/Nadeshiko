import type { ShirabeCandidate } from '~/utils/wordCard';

/**
 * One shared cache of Shirabe word lookups for the whole page.
 *
 * Identical sentence spans share a pending request and a completed answer,
 * even when the same result appears in more than one component. Different
 * sentences remain separate because Shirabe identifies the word from context.
 *
 * Missing words are cached; failed requests can retry. The server route sets a
 * day-long `cache-control` so evicted entries can still hit the HTTP cache.
 *
 * The key includes the sentence and clicked span because identify resolves
 * the word from that context.
 */

/**
 * What a candidate lookup came back with.
 *
 * Missing is a dictionary answer; failed means the request could not complete.
 */
export type WordLookup =
  | { candidates: ShirabeCandidate[]; reason?: undefined }
  | { candidates: []; reason: 'missing' | 'failed' };

/** Shirabe parses the bounded source text and identifies the clicked span. */
export type WordLookupTarget = { text: string; startOffset: number; endOffset?: number };

const inFlight = new Map<string, Promise<WordLookup>>();

/**
 * Keyed by label language as well as by the span, because Shirabe resolves tag
 * labels into a single language and that is the one thing about the response
 * that varies by reader.
 *
 * Field and dialect tags still print Shirabe's label, and it really is
 * translated -- `food` comes back "food, cooking" in English and "gastronomía"
 * in Spanish. Dropping the parameter would put those chips, and every chip's
 * full-wording tooltip, back into English for Spanish readers.
 *
 * It costs less than it looks. A reader's locale is fixed for their session, so
 * no browser normally holds two language copies of a span: only the shared caches (ours at
 * the edge, Shirabe's) carry a variant per language, which is what shared caches
 * are for.
 */
/** `/identify` is context-sensitive, so cache the text and UTF-16 span. */
function positionedCacheKey(target: WordLookupTarget, locale: string, stack: string): string {
  return `identify\u0000${target.text}\u0000${target.startOffset}\u0000${target.endOffset ?? ''}:${locale}:${stack}`;
}

/**
 * The reader's own dictionary stack, when they have linked a Shirabe account.
 *
 * Not an input to the lookup. The server route makes the call with their key and
 * Shirabe resolves the stack from that, so this changes no answer -- it is a
 * CACHE KEY, and the only one that can do the job. The response is
 * `private, max-age=86400`, so without something in the URL that moves when the
 * stack does, a reader who switches a dictionary off in Shirabe keeps being
 * shown it on every word they have already hovered, until tomorrow.
 *
 * PUSHED here by the auth store rather than read from it, and the direction
 * matters: this module is plain functions over a token, and importing a Pinia
 * store to reach one string would drag the whole Nuxt runtime (`#app`) into
 * every caller and every test of them. The store already knows the moment a
 * session lands, which is the only moment this can change.
 *
 * Empty for an unlinked reader, which is nearly everybody, and their URLs are
 * exactly what they always were.
 */
let readerStackFingerprint = '';

export function setReaderStack(fingerprint: string | null | undefined): void {
  readerStackFingerprint = fingerprint ?? '';
}

function readerStack(): string {
  return readerStackFingerprint;
}

/** The answers we already have. Separate from `inFlight` because a caller needs
 *  to distinguish "answered, and it was nothing" from "never asked"
 *  (undefined), which a promise map cannot express. */
const resolved = new Map<string, WordLookup>();

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

type CandidateResponse = {
  candidates: ShirabeCandidate[];
  stackFingerprint?: string;
};

function fetchCandidates(
  keyForStack: (stack: string) => string,
  request: (stack: string) => Promise<CandidateResponse>,
): Promise<WordLookup> {
  const stack = readerStack();
  const key = keyForStack(stack);
  const answered = recall(resolved, key);
  if (answered) return Promise.resolve(answered);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = request(stack)
    .then((answer): WordLookup => {
      let answerKey = key;
      const observed = answer?.stackFingerprint;
      if (observed && observed !== stack) {
        setReaderStack(observed);
        resolved.clear();
        answerKey = keyForStack(observed);
      }
      const candidates = answer?.candidates ?? [];
      return candidates.length
        ? remember(resolved, answerKey, { candidates })
        : remember(resolved, answerKey, { candidates: [], reason: 'missing' });
    })
    .catch((error: unknown): WordLookup => {
      const failure = error as { response?: { status?: number }; statusCode?: number };
      const status = failure?.response?.status ?? failure?.statusCode;
      // A missing word is a stable answer. A transport failure must retry.
      return status === 404
        ? remember(resolved, key, { candidates: [], reason: 'missing' })
        : { candidates: [], reason: 'failed' };
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, lookup);
  return lookup;
}

// The source-complete API response replaces an older cached shape. Include a
// version in the HTTP URL so existing day-long browser caches refresh once.
const LOOKUP_RESPONSE_VERSION = 2;

/** Position-based identify keeps the source and UTF-16 span in its cache key. */
export function fetchWordAt(target: WordLookupTarget, locale: string): Promise<WordLookup> {
  return fetchCandidates(
    (stack) => positionedCacheKey(target, locale, stack),
    (stack) =>
      $fetch<CandidateResponse>(
        `/api/shirabe/words/candidates/${encodeURIComponent(target.text.slice(target.startOffset, target.endOffset))}`,
        {
          query: {
            v: LOOKUP_RESPONSE_VERSION,
            locale,
            text: target.text,
            startOffset: target.startOffset,
            ...(target.endOffset !== undefined ? { endOffset: target.endOffset } : {}),
            ...(stack ? { stack } : {}),
          },
          timeout: 8000,
        },
      ),
  );
}

/** Internal probe for cache tests. */
function peekWordAt(target: WordLookupTarget, locale: string): WordLookup | undefined {
  return recall(resolved, positionedCacheKey(target, locale, readerStack()));
}

// The positioned key decides which two requests can share an answer. The text,
// span, locale, and reader stack must all match.
// `CACHE_LIMIT` is here so the eviction test can fill the map exactly to its
// edge rather than hardcoding 600 in two places and silently testing nothing
// the day the bound changes.
export const __testing = { positionedCacheKey, CACHE_LIMIT, peekWordAt };
