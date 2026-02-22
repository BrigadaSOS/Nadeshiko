import { describe, it, expect, afterEach } from 'bun:test';
import { Cache, createCacheNamespace } from '../../lib/cache';

const ns = createCacheNamespace('test');

afterEach(() => {
  Cache.invalidate(ns);
});

describe('createCacheNamespace', () => {
  it('returns a unique symbol', () => {
    const a = createCacheNamespace('foo');
    const b = createCacheNamespace('foo');
    expect(typeof a).toBe('symbol');
    expect(a).not.toBe(b);
  });
});

describe('Cache.fetch', () => {
  it('calls compute on first access', async () => {
    let calls = 0;
    const result = await Cache.fetch(ns, 'k', 1000, async () => {
      calls++;
      return 'value';
    });
    expect(result).toBe('value');
    expect(calls).toBe(1);
  });

  it('returns cached value without calling compute again', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 'value'; };

    await Cache.fetch(ns, 'k', 1000, compute);
    const result = await Cache.fetch(ns, 'k', 1000, compute);

    expect(result).toBe('value');
    expect(calls).toBe(1);
  });

  it('re-computes after TTL expires', async () => {
    let calls = 0;
    const compute = async () => { calls++; return calls; };

    await Cache.fetch(ns, 'k', 1, compute);
    await new Promise(r => setTimeout(r, 5));
    const result = await Cache.fetch(ns, 'k', 1000, compute);

    expect(result).toBe(2);
    expect(calls).toBe(2);
  });

  it('isolates keys within the same namespace', async () => {
    await Cache.fetch(ns, 'a', 1000, async () => 'alpha');
    const b = await Cache.fetch(ns, 'b', 1000, async () => 'beta');

    expect(b).toBe('beta');
  });

  it('isolates different namespaces', async () => {
    const ns2 = createCacheNamespace('other');
    let calls = 0;

    await Cache.fetch(ns, 'k', 1000, async () => { calls++; return 'ns1'; });
    await Cache.fetch(ns2, 'k', 1000, async () => { calls++; return 'ns2'; });

    expect(calls).toBe(2);
    Cache.invalidate(ns2);
  });
});

describe('Cache.fetch with falsy values', () => {
  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
  ])('caches %s without re-computing', async (_label, falsy) => {
    let calls = 0;
    const compute = async () => { calls++; return falsy; };

    await Cache.fetch(ns, 'k', 1000, compute);
    const result = await Cache.fetch(ns, 'k', 1000, compute);

    expect(result).toBe(falsy);
    expect(calls).toBe(1);
  });

  it('re-computes when compute throws', async () => {
    let calls = 0;

    await expect(
      Cache.fetch(ns, 'k', 1000, async () => { calls++; throw new Error('boom'); })
    ).rejects.toThrow('boom');

    const result = await Cache.fetch(ns, 'k', 1000, async () => { calls++; return 'ok'; });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('Cache.invalidate', () => {
  it('is a no-op for an unknown namespace', () => {
    const unknown = createCacheNamespace('never-used');
    expect(() => Cache.invalidate(unknown)).not.toThrow();
  });

  it('clears all keys in the namespace', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 'v'; };

    await Cache.fetch(ns, 'a', 1000, compute);
    await Cache.fetch(ns, 'b', 1000, compute);

    Cache.invalidate(ns);

    await Cache.fetch(ns, 'a', 1000, compute);
    await Cache.fetch(ns, 'b', 1000, compute);

    expect(calls).toBe(4);
  });

  it('does not affect other namespaces', async () => {
    const ns2 = createCacheNamespace('isolated');
    let calls = 0;

    await Cache.fetch(ns2, 'k', 1000, async () => { calls++; return 'v'; });
    Cache.invalidate(ns);
    await Cache.fetch(ns2, 'k', 1000, async () => { calls++; return 'v'; });

    expect(calls).toBe(1);
    Cache.invalidate(ns2);
  });
});
