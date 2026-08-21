/**
 * The machinery behind `segmentCache` and `mediaCache`: a short-lived,
 * per-process cache that also collapses concurrent misses into one call.
 *
 * Extracted from `segmentCache.ts` when the media lookup needed the same two
 * properties. The reasoning that justifies the shape lives there and is not
 * repeated here; what follows is only what the extraction itself has to get
 * right.
 *
 * EACH CACHE GETS ITS OWN STORE, and that is not tidiness. Segment and media
 * public IDs are drawn from the same `^[A-Za-z0-9_-]{12}$` alphabet, so a
 * single shared map keyed on the bare ID would let a media entry answer a
 * segment lookup the moment the two spaces collide. A caller would get a
 * `Media` where it expected a `Segment`, typed as whatever it asked for. One
 * store per corpus type makes that unrepresentable rather than unlikely.
 *
 * THE SAFETY RULE IS INHERITED, NOT RELAXED. A cache built here is keyed on the
 * corpus ID and nothing else, which is only correct for data that is identical
 * for every visitor -- the generated public-route allowlist
 * (`server/utils/generated/publicApiRoutes.ts`) is the test. Anything
 * owner-scoped needs the reader's identity in the key or the first visitor's
 * response is served to the next one.
 */

type Entry<T> =
  | { kind: 'inflight'; promise: Promise<T>; startedAt: number }
  | { kind: 'value'; value: T; expiresAt: number };

/**
 * How long a call may be in flight before its entry stops being reused.
 *
 * An inflight entry has no natural expiry -- it is not a value with a TTL, it
 * is a promise -- so without a deadline a single hung upstream pins its key
 * until the fetch itself gives up. The SDK sets no timeout of its own, which
 * leaves undici's 300s default, and for a media ID that is every sentence page
 * of the title serving the same never-settling promise for five minutes.
 *
 * Fifteen seconds is far longer than a healthy call and far shorter than that.
 * Passing it only costs the *deduplication*: waiters already holding the
 * promise still get whatever it settles to, and the next caller starts a fresh
 * fetch instead of joining a call that has stopped looking alive.
 */
const DEFAULT_INFLIGHT_TIMEOUT_MS = 15_000;

export interface CorpusCacheOptions {
  /** How long a fetched value is served before the backend is asked again. */
  ttlMs: number;
  /** Backstop against a crawler walking the corpus and growing this forever. */
  maxEntries: number;
  /** Defaults to `DEFAULT_INFLIGHT_TIMEOUT_MS`; see there for why one is needed. */
  inflightTimeoutMs?: number;
}

export interface CorpusCache {
  /**
   * Run `fetcher` for `key`, reusing a fresh answer or an in-flight one.
   *
   * Errors are never cached, and a failed call clears its inflight entry, so a
   * backend blip cannot pin an ID to an error for the rest of the TTL. That
   * includes 404s: caching "does not exist" would let a mistyped or enumerated
   * ID occupy an entry, and it would make newly published corpus data invisible
   * for the whole TTL for no gain.
   */
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
      // A call that has been in flight past the deadline is no longer something
      // to hand the next reader. Dropping the entry does not abort it -- there
      // is nothing here to abort it with -- so it may still settle later and
      // find its key taken by a fresher attempt, which is what the identity
      // checks in `fetch` are for.
      if (e.kind === 'inflight' && now - e.startedAt >= inflightTimeoutMs) store.delete(k);
    }

    // Still over after dropping what expired: evict oldest-first. Map preserves
    // insertion order, so the head is the least recently *added* entry. Not a
    // true LRU, and deliberately not -- a hot entry being re-added on expiry is
    // the common case, and the accounting an LRU needs is not worth it here.
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

      // Declared up front so the settlement handlers can ask whether the entry
      // they are about to write is still their own. A call swept by `gc` for
      // overrunning the deadline still settles eventually, and by then the key
      // may belong to a newer attempt -- caching a stale value over it, or
      // worse, deleting a live inflight entry on the error path, would make the
      // timeout actively harmful. Both writes below are no-ops in that case.
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
