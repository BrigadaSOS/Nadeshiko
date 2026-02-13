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

  async fetch<T>(namespace: CacheNamespace, key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const nsStore = this.store.get(namespace);
    if (nsStore) {
      const entry = nsStore.get(key);
      if (entry && entry.expiresAt > Date.now()) {
        return entry.value as T;
      }
      if (entry) {
        nsStore.delete(key);
      }
    }

    const value = await compute();

    let targetStore = this.store.get(namespace);
    if (!targetStore) {
      targetStore = new Map();
      this.store.set(namespace, targetStore);
    }
    targetStore.set(key, { expiresAt: Date.now() + ttlMs, value });

    return value;
  }

  invalidate(namespace: CacheNamespace): void {
    this.store.delete(namespace);
  }
}

export const Cache = new AppCache();
