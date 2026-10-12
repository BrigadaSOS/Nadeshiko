import { describe, it, expect, vi } from 'vitest';
import { cachedMedia, _resetMediaCacheForTests } from './mediaCache';
import { cachedSegment, _resetSegmentCacheForTests as _resetSegmentsForTests } from './segmentCache';
import { createPublicRouteMatcher } from '#shared/utils/backendSdk';
import { publicApiRoutes } from './generated/publicApiRoutes';

// ID-only caching requires the route to remain public/service-signed. If this fails, fix the spec or add identity
// to the cache key; do not relax the assertion and leak viewer-dependent data.
describe('cachedMedia safety precondition', () => {
  it('only caches a route the SSR SDK fetches with the shared service key', () => {
    const isPublicRoute = createPublicRouteMatcher(publicApiRoutes);
    expect(isPublicRoute('GET', '/v1/media/AbCdEfGhIjKl')).toBe(true);
  });

  it('discriminates -- so the assertion above is not vacuously true', () => {
    // Reject an always-true matcher so the public-route guard cannot pass vacuously.
    const isPublicRoute = createPublicRouteMatcher(publicApiRoutes);
    expect(isPublicRoute('GET', '/v1/user/me')).toBe(false);
    expect(isPublicRoute('PATCH', '/v1/media/AbCdEfGhIjKl')).toBe(false);
  });
});

describe('cachedMedia', () => {
  it('serves a repeat lookup without calling the backend again', async () => {
    _resetMediaCacheForTests();
    const fetcher = vi.fn(async () => ({ publicId: 'med_1' }));

    const first = await cachedMedia('med_1', fetcher);
    const second = await cachedMedia('med_1', fetcher);

    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent renders of the same title into ONE call', async () => {
    _resetMediaCacheForTests();
    let resolveFetch: (v: unknown) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const inFlight = Array.from({ length: 50 }, () => cachedMedia('med_hot', fetcher));
    resolveFetch({ publicId: 'med_hot' });
    const results = await Promise.all(inFlight);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(50);
  });

  it('does not cache failures, and retries the next caller', async () => {
    _resetMediaCacheForTests();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('backend down')).mockResolvedValue({ publicId: 'med_1' });

    await expect(cachedMedia('med_1', fetcher)).rejects.toThrow('backend down');
    await expect(cachedMedia('med_1', fetcher)).resolves.toEqual({ publicId: 'med_1' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('holds the whole catalogue without evicting', async () => {
    _resetMediaCacheForTests();
    for (let i = 0; i < 325; i++) {
      await cachedMedia(`med_${i}`, async () => ({ publicId: `med_${i}` }));
    }

    const fetcher = vi.fn(async () => ({ publicId: 'med_0' }));
    await cachedMedia('med_0', fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not share a store with the segment cache', async () => {
    // Media and segment IDs can collide; their stores must remain distinct.
    _resetMediaCacheForTests();
    _resetSegmentsForTests();

    const collidingId = 'AbCdEfGhIjKl';
    const segment = await cachedSegment(collidingId, async () => ({ kind: 'segment' }));
    const media = await cachedMedia(collidingId, async () => ({ kind: 'media' }));

    expect(segment).toEqual({ kind: 'segment' });
    expect(media).toEqual({ kind: 'media' });
  });
});
