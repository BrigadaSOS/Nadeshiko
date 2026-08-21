import { createCorpusCache } from './ssrCorpusCache';

/**
 * A per-process cache for the media (title) record an SSR render needs.
 *
 * WHY THIS EXISTS. `GET /v1/media/:mediaPublicId` was the busiest route on the
 * backend and almost none of the work was real. Measured over the 24h to
 * 2026-08-22: 426,828 requests from Googlebot alone, against **325 distinct
 * media IDs** — roughly 1,313 fetches of each title per day, with the hottest
 * single ID served 562 times in one hour. The catalogue is a few hundred
 * titles; every one of those responses was byte-identical to the last.
 *
 * The cause is an N+1 across a crawl rather than within a request. A sentence
 * permalink renders one segment and then fetches that segment's parent title,
 * and hundreds of segments share one parent — so a crawler walking 213,153
 * distinct sentence pages (which it did, in the same window) drags the same 325
 * titles behind it, once per page. `segmentCache` did not help: it made the
 * segment half of the render free, which only made the media half a *larger*
 * share of what was left. That is why media requests (426k) outnumbered segment
 * requests (242k) — a segment cache hit still fell through to a live media call.
 *
 * WHY FIFTEEN MINUTES, which is neither neighbour's number and is the one
 * decision here worth arguing with. An hour was the first choice, to match
 * `mediaSlugIndex.ts`. It is wrong, and `server/api/media/by-slug/[slug].get.ts`
 * says why in its own comment: that route deliberately keeps only the slug->id
 * mapping in the hour-long index and fetches the record fresh, because "caching
 * whole media objects there would mean a stale banner or episode count for up to
 * an hour". Shipping an hour-long cache of whole media objects one module over
 * would have quietly overturned that, which is not a thing to do by accident.
 *
 * Five minutes was the other candidate, matching `segmentCache`. That number is
 * calibrated to contributor-facing segment revisions -- a correction that takes
 * an hour to appear reads as a bug -- and nothing about a media record is edited
 * on that loop.
 *
 * Fifteen minutes takes almost the whole win while staying well inside the
 * staleness the by-slug note objects to. Against the measured ~17,800 media
 * requests an hour, a 325-title catalogue refreshed four times an hour is a
 * ~93% cut; an hour-long TTL would make it ~98%, and the last five points are
 * not worth contradicting a documented decision for. The only genuinely moving
 * field is `segmentCount` / `episodeCount` on an actively-ingesting title.
 *
 * SAFETY: `getMedia` is on the generated public-route allowlist
 * (`server/utils/generated/publicApiRoutes.ts`, `GET /v1/media/{mediaPublicId}`),
 * so it is corpus data signed with the service credential and identical for
 * every visitor — the same test `segmentCache` documents at length. The DTO
 * (`toMediaBaseDTO` in the backend) is a pure function of the Media row and
 * carries no viewer-dependent field, so there is nothing to vary by reader and
 * no reason to restrict this to anonymous ones.
 */

/** Fifteen minutes. See the note above on why this is neither `segmentCache`'s
 *  five minutes nor `mediaSlugIndex`'s hour. */
const TTL_MS = 15 * 60 * 1000;

/** The catalogue is ~325 titles. The cap is an order of magnitude above that so
 *  it is a backstop against ID enumeration rather than a working constraint:
 *  under real traffic this cache holds the entire catalogue and never evicts. */
const MAX_ENTRIES = 5_000;

const cache = createCorpusCache({ ttlMs: TTL_MS, maxEntries: MAX_ENTRIES });

/**
 * Run `fetcher` for `mediaPublicId`, reusing a fresh answer or an in-flight one.
 *
 * Concurrent renders collapse into one call, which matters more here than for
 * segments: a crawler hitting fifty different sentence pages of the same show
 * at once produces fifty simultaneous lookups of one title, and every one of
 * them is a miss under a plain TTL cache.
 *
 * Errors are never cached — including 404s, so a title that fails to load once
 * is not written off for the hour.
 */
export function cachedMedia<T>(mediaPublicId: string, fetcher: () => Promise<T>): Promise<T> {
  return cache.fetch(mediaPublicId, fetcher);
}

/** Test-only -- DO NOT call from prod code. */
export function _resetForTests(): void {
  cache._resetForTests();
}
