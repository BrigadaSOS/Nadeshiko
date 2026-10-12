import { createCorpusCache } from './ssrCorpusCache';

// Cache title records shared by many sentence renders. Only allowlisted, viewer-independent corpus data may
// be keyed solely by media ID; owner-scoped data would leak between readers.

// Fifteen minutes limits stale banners/episode counts without the more frequent refresh needed for segment revisions.
const TTL_MS = 15 * 60 * 1000;

// Bound memory under ID enumeration rather than limit the normal catalogue.
const MAX_ENTRIES = 5_000;

const cache = createCorpusCache({ ttlMs: TTL_MS, maxEntries: MAX_ENTRIES });

// Concurrent misses share one call; errors, including 404s, are never cached.
export function cachedMedia<T>(mediaPublicId: string, fetcher: () => Promise<T>): Promise<T> {
  return cache.fetch(mediaPublicId, fetcher);
}

// Test-only. Module-specific names avoid collisions in Nitro auto-imports.
export function _resetMediaCacheForTests(): void {
  cache._resetForTests();
}
