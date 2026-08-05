import { describe, it, expect, afterEach } from 'bun:test';
import { Cache, createCacheNamespace } from '../../lib/cache';

const ns = createCacheNamespace('test');
const nsOps = createCacheNamespace('ops');

afterEach(() => {
  Cache.invalidate(ns);
  Cache.invalidate(nsOps);
});

describe('createCacheNamespace', () => {
  it('returns a unique symbol', () => {
    const a = createCacheNamespace('foo');
    const b = createCacheNamespace('foo');
    expect(typeof a).toBe('symbol');
    expect(a).not.toBe(b);
  });
});

describe('Cache.get/set', () => {
  it('returns null for missing keys', () => {
    expect(Cache.get<string>(ns, 'missing')).toBeNull();
  });

  it('supports set/get for a single key', () => {
    Cache.set(ns, 'k', 'value', 1000);
    expect(Cache.get<string>(ns, 'k')).toBe('value');
  });

  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
  ])('stores %s values correctly', (_label, value) => {
    Cache.set(ns, 'k', value, 1000);
    expect(Cache.get(ns, 'k')).toBe(value);
  });

  it('returns null for expired keys', async () => {
    Cache.set(ns, 'k', 'value', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(Cache.get<string>(ns, 'k')).toBeNull();
  });

  it('isolates values across namespaces', () => {
    const ns2 = createCacheNamespace('other');
    Cache.set(ns, 'k', 'one', 1000);
    Cache.set(ns2, 'k', 'two', 1000);

    expect(Cache.get<string>(ns, 'k')).toBe('one');
    expect(Cache.get<string>(ns2, 'k')).toBe('two');

    Cache.invalidate(ns2);
  });
});

describe('Cache.delete', () => {
  it('removes a single key', () => {
    Cache.set(ns, 'a', 1, 1000);
    Cache.set(ns, 'b', 2, 1000);

    Cache.delete(ns, 'a');

    expect(Cache.get<number>(ns, 'a')).toBeNull();
    expect(Cache.get<number>(ns, 'b')).toBe(2);
  });

  it('is a no-op for unknown namespace/key', () => {
    const unknown = createCacheNamespace('never-used');
    expect(() => Cache.delete(unknown, 'x')).not.toThrow();
    expect(() => Cache.delete(ns, 'missing')).not.toThrow();
  });
});

describe('Cache.deleteWhere', () => {
  it('deletes keys matching predicate', () => {
    Cache.set(ns, 'k1', { userId: 1 }, 1000);
    Cache.set(ns, 'k2', { userId: 2 }, 1000);
    Cache.set(ns, 'k3', { userId: 1 }, 1000);

    Cache.deleteWhere<{ userId: number }>(ns, (_key, value) => value.userId === 1);

    expect(Cache.get<{ userId: number }>(ns, 'k1')).toBeNull();
    expect(Cache.get<{ userId: number }>(ns, 'k3')).toBeNull();
    expect(Cache.get<{ userId: number }>(ns, 'k2')).toEqual({ userId: 2 });
  });

  it('skips expired entries and keeps unmatched keys', async () => {
    Cache.set(ns, 'expired', { userId: 1 }, 1);
    Cache.set(ns, 'active', { userId: 2 }, 1000);
    await new Promise((r) => setTimeout(r, 5));

    Cache.deleteWhere<{ userId: number }>(ns, (_key, value) => value.userId === 1);

    expect(Cache.get<{ userId: number }>(ns, 'expired')).toBeNull();
    expect(Cache.get<{ userId: number }>(ns, 'active')).toEqual({ userId: 2 });
  });
});

describe('Cache.invalidate', () => {
  it('is a no-op for unknown namespace', () => {
    const unknown = createCacheNamespace('never-used');
    expect(() => Cache.invalidate(unknown)).not.toThrow();
  });

  it('clears all keys in a namespace', () => {
    Cache.set(ns, 'a', 'alpha', 1000);
    Cache.set(ns, 'b', 'beta', 1000);

    Cache.invalidate(ns);

    expect(Cache.get<string>(ns, 'a')).toBeNull();
    expect(Cache.get<string>(ns, 'b')).toBeNull();
  });

  it('does not affect other namespaces', () => {
    const ns2 = createCacheNamespace('isolated');
    Cache.set(ns, 'k', 'one', 1000);
    Cache.set(ns2, 'k', 'two', 1000);

    Cache.invalidate(ns);

    expect(Cache.get<string>(ns, 'k')).toBeNull();
    expect(Cache.get<string>(ns2, 'k')).toBe('two');

    Cache.invalidate(ns2);
  });
});

describe('Cache eviction', () => {
  it('caps a namespace at its configured size', () => {
    const bounded = createCacheNamespace('bounded', 3);

    for (let i = 0; i < 10; i++) {
      Cache.set(bounded, `k${i}`, i, 1000);
    }

    const survivors = Array.from({ length: 10 }, (_, i) => Cache.get<number>(bounded, `k${i}`)).filter(
      (value) => value !== null,
    );
    expect(survivors).toHaveLength(3);

    Cache.invalidate(bounded);
  });

  it('evicts the least recently used entry first', () => {
    const bounded = createCacheNamespace('lru', 2);

    Cache.set(bounded, 'a', 'alpha', 1000);
    Cache.set(bounded, 'b', 'beta', 1000);
    // Touching 'a' makes 'b' the least recently used.
    expect(Cache.get<string>(bounded, 'a')).toBe('alpha');
    Cache.set(bounded, 'c', 'gamma', 1000);

    expect(Cache.get<string>(bounded, 'a')).toBe('alpha');
    expect(Cache.get<string>(bounded, 'b')).toBeNull();
    expect(Cache.get<string>(bounded, 'c')).toBe('gamma');

    Cache.invalidate(bounded);
  });

  it('drops expired entries before evicting live ones', async () => {
    const bounded = createCacheNamespace('expiry-first', 2);

    Cache.set(bounded, 'stale', 'old', 1);
    await new Promise((r) => setTimeout(r, 5));
    Cache.set(bounded, 'live', 'current', 1000);
    Cache.set(bounded, 'fresh', 'newest', 1000);

    expect(Cache.get<string>(bounded, 'stale')).toBeNull();
    expect(Cache.get<string>(bounded, 'live')).toBe('current');
    expect(Cache.get<string>(bounded, 'fresh')).toBe('newest');

    Cache.invalidate(bounded);
  });

  it('does not evict across namespaces', () => {
    const boundedA = createCacheNamespace('tight', 1);
    const boundedB = createCacheNamespace('roomy', 100);

    Cache.set(boundedA, 'a', 1, 1000);
    Cache.set(boundedB, 'a', 1, 1000);
    Cache.set(boundedB, 'b', 2, 1000);
    Cache.set(boundedA, 'b', 2, 1000);

    expect(Cache.get<number>(boundedA, 'a')).toBeNull();
    expect(Cache.get<number>(boundedA, 'b')).toBe(2);
    expect(Cache.get<number>(boundedB, 'a')).toBe(1);
    expect(Cache.get<number>(boundedB, 'b')).toBe(2);

    Cache.invalidate(boundedA);
    Cache.invalidate(boundedB);
  });

  it('overwriting an existing key does not grow the namespace', () => {
    const bounded = createCacheNamespace('overwrite', 2);

    Cache.set(bounded, 'a', 1, 1000);
    Cache.set(bounded, 'a', 2, 1000);
    Cache.set(bounded, 'b', 3, 1000);

    expect(Cache.get<number>(bounded, 'a')).toBe(2);
    expect(Cache.get<number>(bounded, 'b')).toBe(3);

    Cache.invalidate(bounded);
  });
});

describe('External compute pattern', () => {
  it('supports get-or-compute behavior without cache helper', async () => {
    let calls = 0;
    const getOrCompute = async () => {
      const cached = Cache.get<number>(nsOps, 'count');
      if (cached !== null) {
        return cached;
      }

      calls++;
      const value = 42;
      Cache.set(nsOps, 'count', value, 1000);
      return value;
    };

    const first = await getOrCompute();
    const second = await getOrCompute();

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(calls).toBe(1);
  });
});
