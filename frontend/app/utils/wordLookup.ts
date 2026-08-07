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

/** True when the answer is already here, so a caller can render without a
 *  loading state rather than flashing one for a word it already has. */
export function hasWord(wid: string, locale: string): boolean {
  return resolved.has(cacheKey(wid, locale));
}

/** The resolved answers, so a synchronous render can use one immediately. */
const resolved = new Map<string, ShirabeWord | null>();

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
  })
    .then((word) => {
      resolved.set(key, word);
      return word;
    })
    .catch(() => {
      resolved.set(key, null);
      return null;
    })
    .finally(() => {
      // Only the in-flight entry is cleared; `resolved` keeps the answer.
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
