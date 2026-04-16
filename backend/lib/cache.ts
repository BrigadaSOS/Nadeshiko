export type CacheNamespace = symbol;

export function createCacheNamespace(name: string): CacheNamespace {
  return Symbol(name);
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

    targetStore.set(key, { expiresAt, value });
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
}

export const Cache = new AppCache();
