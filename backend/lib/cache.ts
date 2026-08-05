export type CacheNamespace = symbol;

/** Fallback cap for namespaces created without an explicit limit. */
const DEFAULT_MAX_ENTRIES = 10_000;

const namespaceLimits = new Map<CacheNamespace, number>();

export function createCacheNamespace(name: string, maxEntries: number = DEFAULT_MAX_ENTRIES): CacheNamespace {
  const namespace = Symbol(name);
  namespaceLimits.set(namespace, maxEntries);
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
   * Keeps a namespace within its entry cap. Expired entries are dropped first so
   * a burst of unique keys does not evict live entries while dead ones linger.
   */
  private evict(namespace: CacheNamespace, nsStore: Map<string, CacheEntry>): void {
    const maxEntries = namespaceLimits.get(namespace) ?? DEFAULT_MAX_ENTRIES;
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
