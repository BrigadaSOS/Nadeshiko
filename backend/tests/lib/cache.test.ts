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
