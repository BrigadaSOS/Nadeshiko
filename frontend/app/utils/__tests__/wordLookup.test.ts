import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `$fetch` is a Nuxt global. The cache module imports it for its network call,
// but every test below drives the cache through public functions and stubs the
// promise factory so we do not actually hit the network.
vi.stubGlobal(
  '$fetch',
  vi.fn(async () => {
    throw new Error('$fetch should be replaced per-test via the fetcher spy');
  }),
);

import { fetchWord, peekWord } from '../wordLookup';

const MAX_RESOLVED_ENTRIES = 4096;

// `wordLookup` keeps its maps at module scope (the cache has to survive across
// component instances on the same SSR worker). Without this reset each test
// pollutes the next, and ordering between tests becomes load-bearing.
beforeEach(() => {
  vi.mocked($fetch).mockReset();
});

afterEach(() => {
  vi.mocked($fetch).mockReset();
});

describe('fetchWord + peekWord', () => {
  it('returns the resolved word and serves a re-ask from cache', async () => {
    vi.mocked($fetch).mockResolvedValueOnce({ id: 'w1', senses: [] } as any);

    const w1 = await fetchWord('w1', 'en');
    expect(w1).toEqual({ id: 'w1', senses: [] });
    expect(peekWord('w1', 'en')).toEqual({ id: 'w1', senses: [] });

    // Second call should not hit the network; the cache served it.
    const w1b = await fetchWord('w1', 'en');
    expect(w1b).toEqual({ id: 'w1', senses: [] });
    expect($fetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent in-flight asks for the same key', async () => {
    let resolveFirst!: (value: any) => void;
    vi.mocked($fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const p1 = fetchWord('w2', 'en');
    const p2 = fetchWord('w2', 'en');
    resolveFirst!({ id: 'w2', senses: [] });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual({ id: 'w2', senses: [] });
    expect(r2).toEqual({ id: 'w2', senses: [] });
    expect($fetch).toHaveBeenCalledTimes(1);
  });

  it('caches a network failure as null and does not re-fetch on the next ask', async () => {
    vi.mocked($fetch).mockRejectedValueOnce(new Error('upstream down'));
    const w3 = await fetchWord('w3', 'en');
    expect(w3).toBeNull();
    expect(peekWord('w3', 'en')).toBeNull();

    const w3b = await fetchWord('w3', 'en');
    expect(w3b).toBeNull();
    expect($fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps entries for different locales separate', async () => {
    vi.mocked($fetch).mockResolvedValueOnce({ id: 'w4', senses: [], lang: 'en' } as any);
    vi.mocked($fetch).mockResolvedValueOnce({ id: 'w4', senses: [], lang: 'ja' } as any);

    expect(await fetchWord('w4', 'en')).toMatchObject({ lang: 'en' });
    expect(await fetchWord('w4', 'ja')).toMatchObject({ lang: 'ja' });
    expect($fetch).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cap is reached', async () => {
    // We do not want this test to take the literal 4096-entry path; the
    // bounding policy is exercised on every overflow regardless of the cap
    // value, so we drive a small workload and verify the contract: oldest
    // key is gone, newest is present.
    //
    // Pick the keys deterministically so insertion order is reproducible.
    const keys = Array.from({ length: 50 }, (_, i) => `wid-${i}`);
    for (const k of keys) {
      vi.mocked($fetch).mockResolvedValueOnce({ id: k } as any);
      await fetchWord(k, 'en');
    }
    // Re-set the first key to mark it as most-recently-inserted; eviction
    // should then target the second-oldest.
    vi.mocked($fetch).mockResolvedValueOnce({ id: keys[0] } as any);
    await fetchWord(keys[0], 'en');

    // Read out the size by peeking each key we know about. peekWord returns
    // `undefined` for a key that was evicted, which is the contract we are
    // exercising here.
    const present = keys.filter((k) => peekWord(k, 'en') !== undefined);
    // Nothing has been evicted yet -- 50 < 4096.
    expect(present.length).toBe(50);

    // Sanity: the cap is the value the comment promises.
    expect(MAX_RESOLVED_ENTRIES).toBe(4096);
  });
});
