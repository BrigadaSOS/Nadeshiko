import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { loadFixtures } from '../fixtures/loader';
import { Media, MEDIA_INFO_CACHE } from '@app/models/Media';
import { Cache } from '@lib/cache';

setupTestSuite();

beforeEach(async () => {
  await loadFixtures(['mediaWithEpisode']);
  Cache.invalidate(MEDIA_INFO_CACHE);
});

afterEach(() => {
  vi.restoreAllMocks();
  Cache.invalidate(MEDIA_INFO_CACHE);
});

describe('Media.getMediaInfoMap', () => {
  it('serves a warm cache without touching the database', async () => {
    const find = vi.spyOn(Media, 'find');

    const first = await Media.getMediaInfoMap();
    const second = await Media.getMediaInfoMap();

    expect(find).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  // Every search asks for this map, and building it is a `Media.find` across two relations.
  // Without a shared promise, the instant the entry expires is the instant every in-flight
  // request runs that query for itself -- exactly when the server can least afford it.
  it('runs one query when several callers miss the cache at once', async () => {
    const find = vi.spyOn(Media, 'find');

    const [first, second, third] = await Promise.all([
      Media.getMediaInfoMap(),
      Media.getMediaInfoMap(),
      Media.getMediaInfoMap(),
    ]);

    expect(find).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('retries after a failed build rather than serving the rejection', async () => {
    const find = vi.spyOn(Media, 'find').mockRejectedValueOnce(new Error('database is down'));

    await expect(Media.getMediaInfoMap()).rejects.toThrow('database is down');
    await expect(Media.getMediaInfoMap()).resolves.toHaveProperty('results');
    expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('Media.getGlobalStats', () => {
  it('runs one set of counts when several callers miss the cache at once', async () => {
    const count = vi.spyOn(Media, 'count');

    const [first, second] = await Promise.all([Media.getGlobalStats(), Media.getGlobalStats()]);

    expect(count).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });
});
