import { describe, it, expect, vi } from 'vitest';
import { createCorpusCache } from './ssrCorpusCache';

/** A promise this test settles by hand, standing in for a backend call. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection this test triggers deliberately must not surface as an
  // unhandled rejection before the assertion gets to it.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const options = { ttlMs: 60_000, maxEntries: 100, inflightTimeoutMs: 1_000 };

describe('createCorpusCache inflight deadline', () => {
  it('collapses concurrent misses while the call still looks alive', async () => {
    const cache = createCorpusCache(options);
    const call = deferred<string>();
    const fetcher = vi.fn(() => call.promise);

    const first = cache.fetch('id', fetcher);
    const second = cache.fetch('id', fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);

    call.resolve('value');
    await expect(first).resolves.toBe('value');
    await expect(second).resolves.toBe('value');
  });

  it('stops handing out a call that has overrun the deadline', async () => {
    // The failure this exists to prevent: one hung upstream pinning a key. For
    // a media ID that is every sentence page of the title serving the same
    // never-settling promise, for as long as the fetch takes to give up --
    // which, with no timeout on the SDK, is undici's 300s default.
    vi.useFakeTimers();
    try {
      const cache = createCorpusCache(options);
      const hung = deferred<string>();
      const first = vi.fn(() => hung.promise);
      const pending = cache.fetch('id', first);

      vi.advanceTimersByTime(options.inflightTimeoutMs + 1);

      const fresh = vi.fn(() => Promise.resolve('fresh'));
      await expect(cache.fetch('id', fresh)).resolves.toBe('fresh');

      // The second reader got a real answer instead of joining the stall.
      expect(first).toHaveBeenCalledTimes(1);
      expect(fresh).toHaveBeenCalledTimes(1);

      // And the first reader is not abandoned -- it still settles to whatever
      // its own call eventually returns.
      hung.resolve('late');
      await expect(pending).resolves.toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a swept call overwrite the entry that replaced it', async () => {
    // Sweeping the entry cannot abort the call behind it, so a swept fetcher
    // settles into a key that now belongs to someone else. Writing there would
    // put a value the cache already decided was too old to wait for on top of a
    // fresher one.
    vi.useFakeTimers();
    try {
      const cache = createCorpusCache(options);
      const hung = deferred<string>();
      const pending = cache.fetch('id', () => hung.promise);

      vi.advanceTimersByTime(options.inflightTimeoutMs + 1);
      await expect(cache.fetch('id', () => Promise.resolve('fresh'))).resolves.toBe('fresh');

      hung.resolve('stale');
      await expect(pending).resolves.toBe('stale');

      const after = vi.fn(() => Promise.resolve('refetched'));
      await expect(cache.fetch('id', after)).resolves.toBe('fresh');
      expect(after).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a swept call delete the entry that replaced it', async () => {
    // The same hazard on the error path, and the worse half of it: the failure
    // handler deletes rather than writes, so an unguarded one would evict a
    // perfectly good cached value and send the next reader back to the backend.
    vi.useFakeTimers();
    try {
      const cache = createCorpusCache(options);
      const hung = deferred<string>();
      const pending = cache.fetch('id', () => hung.promise);

      vi.advanceTimersByTime(options.inflightTimeoutMs + 1);
      await expect(cache.fetch('id', () => Promise.resolve('fresh'))).resolves.toBe('fresh');

      hung.reject(new Error('gave up'));
      await expect(pending).rejects.toThrow('gave up');

      const after = vi.fn(() => Promise.resolve('refetched'));
      await expect(cache.fetch('id', after)).resolves.toBe('fresh');
      expect(after).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still clears its own inflight entry when the call fails normally', async () => {
    // The guard must not cost the original behaviour: an error is never cached,
    // so the next reader retries rather than inheriting a failure.
    const cache = createCorpusCache(options);
    const call = deferred<string>();
    const failing = cache.fetch('id', () => call.promise);

    call.reject(new Error('backend blip'));
    await expect(failing).rejects.toThrow('backend blip');

    const retry = vi.fn(() => Promise.resolve('recovered'));
    await expect(cache.fetch('id', retry)).resolves.toBe('recovered');
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
