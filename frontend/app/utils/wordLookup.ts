import type { ShirabeWord } from '~/utils/wordCard';

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
 * Failures are cached too, as null. A word with no entry is a normal answer and
 * asking again on every hover would spend a request each time to be told the
 * same thing. The server route sets a day-long `cache-control`, so a reload is
 * still served from the HTTP cache rather than from Shirabe.
 */
const inFlight = new Map<string, Promise<ShirabeWord | null>>();

/** Keyed by label language as well as id: it is the one thing that varies the
 *  response, since Shirabe resolves sense tags into a single language. */
function cacheKey(wid: string, locale: string): string {
  return `${wid}:${locale}`;
}

/** The answers we already have. Separate from `inFlight` because a caller needs
 *  to distinguish "answered, and it was nothing" (null) from "never asked"
 *  (undefined), which a promise map cannot express.
 *
 *  Bounded by `MAX_RESOLVED_ENTRIES`: the map is module-scoped (so it survives
 *  across page renders on the SSR process) and would otherwise grow without
 *  limit -- every distinct `wid:locale` a reader asks about adds a key, and
 *  once asked it never falls out. The server route sets a day-long
 *  `cache-control` so a re-ask after eviction still hits the HTTP cache
 *  rather than Shirabe, which is what `peekWord`'s `undefined`-vs-`null`
 *  contract already assumes. The eviction policy is insertion order: when the
 *  cap is reached we drop the oldest entry, matching the LRU approximation
 *  that `peekWord` + `fetchWord` already approximate by treating the cache
 *  as "recently used".
 */
const MAX_RESOLVED_ENTRIES = 4096;
const resolved = new Map<string, ShirabeWord | null>();

function rememberResolved(key: string, value: ShirabeWord | null): void {
  // `Map` keeps insertion order on iteration, so `delete + set` moves the key
  // to the most-recent position without us tracking access timestamps. This
  // matches the comment above: the cache is "asked recently", not "touched
  // recently" -- a reader who has not asked a word for a while is exactly
  // whose entry we want to evict.
  if (resolved.has(key)) resolved.delete(key);
  resolved.set(key, value);
  while (resolved.size > MAX_RESOLVED_ENTRIES) {
    const oldest = resolved.keys().next().value;
    if (oldest === undefined) break;
    resolved.delete(oldest);
  }
}

/** The answer if it is already here, so a card can open filled in rather than
 *  flashing a loading state for a word the page has seen. `undefined` means it
 *  has not been asked; `null` means asked, with no entry. */
export function peekWord(wid: string, locale: string): ShirabeWord | null | undefined {
  return resolved.get(cacheKey(wid, locale));
}

/**
 * The word, from cache when we have it and from Shirabe when we do not.
 *
 * Never rejects: a lookup that fails resolves to null, because every caller
 * treats "no entry" and "could not ask" the same way -- the card falls back to
 * what the token itself knows. Rejecting here would mean each caller repeating
 * the same catch.
 */
export function fetchWord(wid: string, locale: string): Promise<ShirabeWord | null> {
  const key = cacheKey(wid, locale);

  if (resolved.has(key)) return Promise.resolve(resolved.get(key) ?? null);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = $fetch<ShirabeWord>(`/api/shirabe/words/${encodeURIComponent(wid)}`, {
    query: { locale },
    // The server route already bounds its own calls (1.5s direct, 5s public), so
    // anything past this is not the dictionary being slow -- it is a request
    // that is never coming back, and without a bound the card waits on it
    // forever. Resolving to null at least lets the card fall back to what the
    // token itself knows.
    timeout: 8000,
  })
    .then((word) => {
      rememberResolved(key, word);
      return word;
    })
    .catch(() => {
      // `null` (asked, no entry) goes through the same bounded store as a hit:
      // the comment on `rememberResolved` covers why we want to remember it.
      rememberResolved(key, null);
      return null;
    })
    .finally(() => {
      // Only the in-flight entry is cleared; `resolved` keeps the answer.
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
