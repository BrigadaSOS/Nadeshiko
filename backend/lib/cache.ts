import { getMeter } from '@config/telemetry';

type CacheNamespace = symbol;

/** Fallback cap for namespaces created without an explicit limit. */
const DEFAULT_MAX_ENTRIES = 10_000;

interface NamespaceInfo {
  name: string;
  maxEntries: number;
}

const namespaces = new Map<CacheNamespace, NamespaceInfo>();

export function createCacheNamespace(name: string, maxEntries: number = DEFAULT_MAX_ENTRIES): CacheNamespace {
  const namespace = Symbol(name);
  namespaces.set(namespace, { name, maxEntries });
  return namespace;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

class AppCache {
  private store = new Map<CacheNamespace, Map<string, CacheEntry>>();

  get<T>(namespace: CacheNamespace, key: string): T | null {
    const nsStore = this.store.get(namespace);
    if (!nsStore) {
      return null;
    }

    const entry = nsStore.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      nsStore.delete(key);
      if (nsStore.size === 0) {
        this.store.delete(namespace);
      }
      return null;
    }

    // Map iterates in insertion order, so re-inserting marks this key as most
    // recently used and keeps the eviction pass in `set` LRU rather than FIFO.
    nsStore.delete(key);
    nsStore.set(key, entry);

    return entry.value as T;
  }

  async getOrCompute<T>(namespace: CacheNamespace, key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(namespace, key);
    if (cached !== null) return cached;
    const value = await compute();
    this.set(namespace, key, value, ttlMs);
    return value;
  }

  set<T>(namespace: CacheNamespace, key: string, value: T, ttlMs: number): void {
    const expiresAt = Date.now() + ttlMs;
    let targetStore = this.store.get(namespace);
    if (!targetStore) {
      targetStore = new Map();
      this.store.set(namespace, targetStore);
    }

    targetStore.delete(key);
    targetStore.set(key, { expiresAt, value });
    this.evict(namespace, targetStore);
  }

  delete(namespace: CacheNamespace, key: string): void {
    const nsStore = this.store.get(namespace);
    if (!nsStore) {
      return;
    }

    nsStore.delete(key);
    if (nsStore.size === 0) {
      this.store.delete(namespace);
    }
  }

  deleteWhere<T>(namespace: CacheNamespace, predicate: (key: string, value: T) => boolean): void {
    const nsStore = this.store.get(namespace);
    if (!nsStore) {
      return;
    }

    for (const [key, entry] of nsStore) {
      if (entry.expiresAt <= Date.now()) {
        nsStore.delete(key);
        continue;
      }

      if (predicate(key, entry.value as T)) {
        nsStore.delete(key);
      }
    }

    if (nsStore.size === 0) {
      this.store.delete(namespace);
    }
  }

  invalidate(namespace: CacheNamespace): void {
    this.store.delete(namespace);
  }

  /**
   * Live entries in a namespace, expired-but-not-yet-swept included.
   *
   * Counting only unexpired entries would mean walking the namespace on every
   * scrape and would report a number the process does not actually hold: an
   * entry past its TTL still occupies the Map, and the heap it is keeping alive
   * is the thing this number exists to explain.
   */
  size(namespace: CacheNamespace): number {
    return this.store.get(namespace)?.size ?? 0;
  }

  /**
   * Keeps a namespace within its entry cap. Expired entries are dropped first so
   * a burst of unique keys does not evict live entries while dead ones linger.
   */
  private evict(namespace: CacheNamespace, nsStore: Map<string, CacheEntry>): void {
    const maxEntries = namespaces.get(namespace)?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (nsStore.size <= maxEntries) {
      return;
    }

    const now = Date.now();
    for (const [key, entry] of nsStore) {
      if (nsStore.size <= maxEntries) break;
      if (entry.expiresAt <= now) {
        nsStore.delete(key);
      }
    }

    for (const key of nsStore.keys()) {
      if (nsStore.size <= maxEntries) break;
      nsStore.delete(key);
    }
  }
}

export const Cache = new AppCache();

/**
 * How full each namespace is, read at scrape time.
 *
 * THE GAP THIS FILLS, and it is worth being precise about what it does and does
 * not buy. `searchStats` was created without a cap, took the default 10,000
 * entries, and each entry held an aggregation over the whole corpus. The
 * backend then OOM-killed every ~3 hours for three days (Nadeshiko#522) and
 * nothing in the estate could say which of nine caches was holding the heap --
 * the only visible number was old_space climbing.
 *
 * NOT AN ALERT SIGNAL, deliberately. A namespace sitting AT its cap is the
 * healthy steady state of an LRU, so "entries == maxEntries" is not a fault and
 * a rule on it would fire forever. The alarm for the failure this comes from is
 * NadeshikoBackendProdHeapNearOOM, on old_space, in brigadasos-infra. What this
 * is for is the next question after that alarm: which cache, and is its cap
 * still the right size for what it now holds.
 *
 * ENTRY COUNTS, NOT BYTES. Measuring retained size per namespace means walking
 * the values on every scrape, which is the kind of instrumentation that becomes
 * the performance problem it was added to find. The count plus the cap beside
 * it is enough to reason with, as long as whoever reads it remembers that
 * entries differ in size by orders of magnitude between namespaces -- which is
 * the whole lesson of #522.
 *
 * Every namespace is reported every scrape, zeros included: a namespace that
 * vanishes from the output when its last entry expires reads like a broken
 * exporter rather than like an empty cache. `cache.max_entries` is constant per
 * namespace and published beside the count so a dashboard can draw the ceiling
 * without hardcoding it.
 */
export function registerCacheMetrics(): void {
  const meter = getMeter();

  const entries = meter.createObservableGauge('cache.entries', {
    description: 'Live entries held by each in-process cache namespace',
    unit: '{entry}',
  });
  const capacity = meter.createObservableGauge('cache.max_entries', {
    description: 'Entry cap configured for each in-process cache namespace',
    unit: '{entry}',
  });

  meter.addBatchObservableCallback(
    (result) => {
      for (const [namespace, info] of namespaces) {
        const attributes = { 'cache.namespace': info.name };
        result.observe(entries, Cache.size(namespace), attributes);
        result.observe(capacity, info.maxEntries, attributes);
      }
    },
    [entries, capacity],
  );
}
