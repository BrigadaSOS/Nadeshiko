// Each corpus type gets its own store: media and segment IDs can collide. ID-only keys are safe only for
// viewer-independent public data; owner-scoped data requires identity in the key.

type Entry<T> =
  | { kind: 'inflight'; promise: Promise<T>; startedAt: number }
  | { kind: 'value'; value: T; expiresAt: number };

// Stop deduplicating hung calls after this deadline. Existing waiters still receive their original promise;
// expiry does not abort the fetch.
const DEFAULT_INFLIGHT_TIMEOUT_MS = 15_000;

export interface CorpusCacheOptions {
  ttlMs: number;
  // Bound memory under corpus enumeration.
  maxEntries: number;

  inflightTimeoutMs?: number;
}

export interface CorpusCache {
  // Errors, including 404s, are never cached, so failures cannot hide newly published data for the TTL.
  fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T>;
  /** Test-only -- DO NOT call from prod code. */
  _resetForTests(): void;
}

export function createCorpusCache({
  ttlMs,
  maxEntries,
  inflightTimeoutMs = DEFAULT_INFLIGHT_TIMEOUT_MS,
}: CorpusCacheOptions): CorpusCache {
  const store = new Map<string, Entry<unknown>>();

  function gc(now: number): void {
    for (const [k, e] of store) {
      if (e.kind === 'value' && e.expiresAt <= now) store.delete(k);
      // Expired in-flight calls may still settle; fetch checks entry identity before writing or deleting.
      if (e.kind === 'inflight' && now - e.startedAt >= inflightTimeoutMs) store.delete(k);
    }

    // Evict oldest-added entries using Map insertion order, not LRU.
    if (store.size > maxEntries) {
      for (const k of store.keys()) {
        if (store.size <= maxEntries) break;
        store.delete(k);
      }
    }
  }

  return {
    async fetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const now = Date.now();
      gc(now);

      const existing = store.get(key);
      if (existing?.kind === 'value' && existing.expiresAt > now) return existing.value as T;
      if (existing?.kind === 'inflight') return existing.promise as Promise<T>;

      // A timed-out call may settle after a new attempt owns its key. Only mutate entries still owned by this attempt.
      const entry = { kind: 'inflight' } as Extract<Entry<unknown>, { kind: 'inflight' }>;
      entry.startedAt = now;
      entry.promise = (async () => {
        try {
          const value = await fetcher();
          if (store.get(key) === entry) store.set(key, { kind: 'value', value, expiresAt: Date.now() + ttlMs });
          return value;
        } catch (error) {
          if (store.get(key) === entry) store.delete(key);
          throw error;
        }
      })();

      store.set(key, entry);
      return entry.promise as Promise<T>;
    },

    _resetForTests(): void {
      store.clear();
    },
  };
}
