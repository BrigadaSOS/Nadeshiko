import type { SearchResponseOutput } from 'generated/outputTypes';

type CachedExtraStatistics = Pick<SearchResponseOutput, 'statistics' | 'categoryStatistics'>;

const EXTRA_STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const extraStatsCache = new Map<string, { expiresAt: number; value: CachedExtraStatistics }>();

function pruneExpiredEntries(now = Date.now()): void {
  for (const [key, entry] of extraStatsCache) {
    if (entry.expiresAt <= now) {
      extraStatsCache.delete(key);
    }
  }
}

export function getCachedSearchExtraStatistics(cacheKey: string): CachedExtraStatistics | null {
  const now = Date.now();
  pruneExpiredEntries(now);

  const entry = extraStatsCache.get(cacheKey);
  if (!entry || entry.expiresAt <= now) {
    if (entry) {
      extraStatsCache.delete(cacheKey);
    }
    return null;
  }

  return entry.value;
}

export function setCachedSearchExtraStatistics(cacheKey: string, value: CachedExtraStatistics): void {
  if (EXTRA_STATS_CACHE_TTL_MS <= 0) {
    return;
  }

  pruneExpiredEntries();

  extraStatsCache.set(cacheKey, {
    expiresAt: Date.now() + EXTRA_STATS_CACHE_TTL_MS,
    value,
  });
}

export function invalidateSearchExtraStatsCache(): void {
  extraStatsCache.clear();
}
