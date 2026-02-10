import type { SearchStatsResponseOutput } from 'generated/outputTypes';

type CachedSearchStatistics = Pick<SearchStatsResponseOutput, 'mediaStatistics' | 'categoryStatistics'>;

const SEARCH_STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const searchStatsCache = new Map<string, { expiresAt: number; value: CachedSearchStatistics }>();

function pruneExpiredEntries(now = Date.now()): void {
  for (const [key, entry] of searchStatsCache) {
    if (entry.expiresAt <= now) {
      searchStatsCache.delete(key);
    }
  }
}

export function getCachedSearchStatistics(cacheKey: string): CachedSearchStatistics | null {
  const now = Date.now();
  pruneExpiredEntries(now);

  const entry = searchStatsCache.get(cacheKey);
  if (!entry || entry.expiresAt <= now) {
    if (entry) {
      searchStatsCache.delete(cacheKey);
    }
    return null;
  }

  return entry.value;
}

export function setCachedSearchStatistics(cacheKey: string, value: CachedSearchStatistics): void {
  if (SEARCH_STATS_CACHE_TTL_MS <= 0) {
    return;
  }

  pruneExpiredEntries();

  searchStatsCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_STATS_CACHE_TTL_MS,
    value,
  });
}

export function invalidateSearchStatsCache(): void {
  searchStatsCache.clear();
}
