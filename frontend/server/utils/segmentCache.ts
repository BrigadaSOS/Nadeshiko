import { createCorpusCache } from './ssrCorpusCache';

// Cache and coalesce direct SSR corpus fetches; routeRules only cover Nitro-served requests, not this SDK path.
// ID-only keys are safe for allowlisted viewer-independent corpus data, never owner-scoped responses.

// Keep contributor-facing text corrections stale for minutes, not hours.
const TTL_MS = 5 * 60 * 1000;

// Bound memory when crawlers enumerate the corpus.
const MAX_ENTRIES = 2_000;

const cache = createCorpusCache({ ttlMs: TTL_MS, maxEntries: MAX_ENTRIES });

// Keep SDK construction with the caller. Errors, including 404s, are never cached.
export function cachedSegment<T>(publicId: string, fetcher: () => Promise<T>): Promise<T> {
  return cache.fetch(publicId, fetcher);
}

/** Test-only -- DO NOT call from prod code. Named per-module; see `mediaCache.ts`. */
export function _resetSegmentCacheForTests(): void {
  cache._resetForTests();
}
