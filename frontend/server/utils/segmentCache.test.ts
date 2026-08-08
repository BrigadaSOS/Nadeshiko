import { describe, it, expect, vi } from 'vitest';
import { cachedSegment, _resetForTests } from './segmentCache';

describe('cachedSegment', () => {
  it('serves a repeat lookup without calling the backend again', async () => {
    _resetForTests();
    const fetcher = vi.fn(async () => ({ publicId: 'seg_1' }));

    const first = await cachedSegment('seg_1', fetcher);
    const second = await cachedSegment('seg_1', fetcher);

    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent renders of the same segment into ONE call', async () => {
    // The property that actually matters. A burst on one permalink arrives
    // before the first answer lands, so a plain TTL cache would miss on every
    // one of them and forward the whole burst to the backend -- which is the
    // shape that took production down on 2026-08-09.
    _resetForTests();
    let resolveFetch: (v: unknown) => void = () => {};
    const fetcher = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const inFlight = Array.from({ length: 50 }, () => cachedSegment('seg_hot', fetcher));
    resolveFetch({ publicId: 'seg_hot' });
    const results = await Promise.all(inFlight);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(50);
    expect(results.every((r) => (r as { publicId: string }).publicId === 'seg_hot')).toBe(true);
  });

  it('keeps different segments in different entries', async () => {
    _resetForTests();
    const fetcher = vi.fn(async (id: string) => ({ publicId: id }));

    const a = await cachedSegment('seg_a', () => fetcher('seg_a'));
    const b = await cachedSegment('seg_b', () => fetcher('seg_b'));

    expect(a).toEqual({ publicId: 'seg_a' });
    expect(b).toEqual({ publicId: 'seg_b' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures, and retries the next caller', async () => {
    // A cached error would pin a permalink to a failure for the whole TTL over
    // a single backend blip.
    _resetForTests();
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('backend down')).mockResolvedValue({ publicId: 'seg_1' });

    await expect(cachedSegment('seg_1', fetcher)).rejects.toThrow('backend down');
    await expect(cachedSegment('seg_1', fetcher)).resolves.toEqual({ publicId: 'seg_1' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('propagates a rejection to every caller waiting on the same inflight call', async () => {
    _resetForTests();
    const fetcher = vi.fn(() => Promise.reject(new Error('boom')));

    const waiters = [
      cachedSegment('seg_x', fetcher).catch((e: Error) => e.message),
      cachedSegment('seg_x', fetcher).catch((e: Error) => e.message),
    ];

    expect(await Promise.all(waiters)).toEqual(['boom', 'boom']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stays bounded when a crawler walks the corpus', async () => {
    // Without the cap this is a slow memory leak: one entry per segment, and
    // the corpus is far larger than any process should hold.
    _resetForTests();
    for (let i = 0; i < 2_500; i++) {
      await cachedSegment(`seg_${i}`, async () => ({ publicId: `seg_${i}` }));
    }

    // Nothing has expired (TTL is 5 minutes), so only the size cap can have
    // bounded this. Re-reading an early key must therefore call the backend.
    const fetcher = vi.fn(async () => ({ publicId: 'seg_0' }));
    await cachedSegment('seg_0', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
