import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock metrics before import: the module resolves its meter once, so a later spy misses it.
const adds: Array<{ value: number; attributes: Record<string, unknown> }> = [];

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: () => ({
      createCounter: () => ({
        add: (value: number, attributes: Record<string, unknown>) => adds.push({ value, attributes }),
      }),
    }),
  },
}));

import {
  dropSessionEntries,
  hasSessionCookie,
  recordAnonymousRender,
  ssrAuthFetch,
  _resetSsrAuthCacheForTests,
} from './ssrAuthCache';

function outcomes(): string[] {
  return adds.map((a) => String(a.attributes.outcome));
}

beforeEach(() => {
  _resetSsrAuthCacheForTests();
  adds.length = 0;
});

function fakeEvent(cookieHeader?: string, ip = '1.2.3.4') {
  return {
    node: { req: { socket: { remoteAddress: ip }, headers: { cookie: cookieHeader } } },
    headers: { cookie: cookieHeader },
  } as any;
}

describe('hasSessionCookie', () => {
  it('is false when the request carries no cookies at all', () => {
    expect(hasSessionCookie(fakeEvent(undefined))).toBe(false);
  });

  it('is false when cookies are present but none is a session', () => {
    expect(hasSessionCookie(fakeEvent('nd_lang_prefs=en:hidden; nd-locale-preference=es'))).toBe(false);
  });

  it('is true for the plain cookie', () => {
    expect(hasSessionCookie(fakeEvent('nadeshiko.session_token=tok1'))).toBe(true);
  });

  it('is true for the __Secure- and __Host- prefixes production uses', () => {
    expect(hasSessionCookie(fakeEvent('__Secure-nadeshiko.session_token=tok1'))).toBe(true);
    expect(hasSessionCookie(fakeEvent('__Host-nadeshiko.session_token=tok1'))).toBe(true);
  });

  it('is false for an empty session cookie value', () => {
    expect(hasSessionCookie(fakeEvent('nadeshiko.session_token='))).toBe(false);
  });

  it('does not mistake a lookalike cookie name for a session', () => {
    expect(hasSessionCookie(fakeEvent('nadeshiko.session_token_backup=tok1'))).toBe(false);
  });
});

describe('ssrAuthFetch', () => {
  it('returns the upstream response and caches it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ user: { id: 1, name: 'alice' } });
    const r1 = await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    const r2 = await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    expect(r1).toEqual({ user: { id: 1, name: 'alice' } });
    expect(r2).toEqual({ user: { id: 1, name: 'alice' } });
    expect(fetcher).toHaveBeenCalledTimes(1); // coalesced!
  });

  // A browser stamp invalidates its key across processes; local deletion alone cannot.
  it('does NOT reuse the pre-change entry once a preferences stamp arrives', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version=1786690000000'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('still caches across renders while the same stamp is in play', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    const cookie = 'nadeshiko.session_token=tok1; nd-prefs-version=1786690000000';
    await ssrAuthFetch(fakeEvent(cookie), fetcher);
    await ssrAuthFetch(fakeEvent(cookie), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('separates two stamps, so a second change is not served the first result', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version=1786690000000'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version=1786690009999'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('forgets a session entirely when a write drops it, stamp or no stamp', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    const plain = fakeEvent('nadeshiko.session_token=tok1');
    const stamped = fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version=1786690000000');
    await ssrAuthFetch(plain, fetcher);
    await ssrAuthFetch(stamped, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);

    dropSessionEntries(plain);
    await ssrAuthFetch(plain, fetcher);
    await ssrAuthFetch(stamped, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('drops only the session it was asked about', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokA'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokB'), fetcher);

    dropSessionEntries(fakeEvent('nadeshiko.session_token=tokA'));

    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokB'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // B still cached
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokA'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3); // A had to be re-read
  });

  it('ignores a stamp that is not one this server could have minted', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);

    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version=../../etc'), fetcher);
    await ssrAuthFetch(fakeEvent(`nadeshiko.session_token=tok1; nd-prefs-version=${'9'.repeat(400)}`), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1; nd-prefs-version='), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps two readers apart even when they stamp the same millisecond', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokA; nd-prefs-version=1786690000000'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokB; nd-prefs-version=1786690000000'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does NOT coalesce across different session tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok2'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares one entry for cookie-less requests, whatever their IP', async () => {
    // identity-auth skips cookie-less reads, so the fallback needs no per-IP identity.
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent(undefined, '1.1.1.1'), fetcher);
    await ssrAuthFetch(fakeEvent(undefined, '2.2.2.2'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('respects __Secure- and __Host- prefixed cookies', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('__Secure-nadeshiko.session_token=tokA'), fetcher);
    await ssrAuthFetch(fakeEvent('__Host-nadeshiko.session_token=tokA'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2); // different prefix => different key
  });

  it('retries upstream after an error, does not poison the cache', async () => {
    let n = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 1) throw new Error('upstream down');
      return { ok: true };
    });
    await expect(ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokZ'), fetcher)).rejects.toThrow('upstream down');
    const r2 = await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokZ'), fetcher);
    expect(r2).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expires after the TTL', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokT'), fetcher);

    vi.advanceTimersByTime(59_999);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokT'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokT'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('hashes long tokens to a bounded key length', async () => {
    const long = 'a'.repeat(500);
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent(`nadeshiko.session_token=${long}`), fetcher);
    await ssrAuthFetch(fakeEvent(`nadeshiko.session_token=${long}`), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

// resetModules/reimport models separate SSR and Nitro bundle instances; they must see and invalidate one store.
describe('one cache across module instances', () => {
  it('lets a second instance of this module see and invalidate the first one’s entries', async () => {
    const event = fakeEvent('nadeshiko.session_token=shared-tok');

    const first = await import('./ssrAuthCache');
    await first.ssrAuthFetch(event, async () => 'cached-by-first');

    vi.resetModules();
    const second = await import('./ssrAuthCache');
    expect(second).not.toBe(first);

    const seen = await second.ssrAuthFetch(event, async () => 'fetched-again');
    expect(seen).toBe('cached-by-first');

    second.dropSessionEntries(event);
    const afterDrop = await first.ssrAuthFetch(event, async () => 'refetched');
    expect(afterDrop).toBe('refetched');
  });
});

// The same session may cache different response shapes; scopes prevent callers reading each other's answers.
describe('scopes', () => {
  const SIGNED_IN = 'nadeshiko.session_token=tok1';

  it('does not serve one caller the other caller answer', async () => {
    const event = fakeEvent(SIGNED_IN);

    const identity = await ssrAuthFetch(event as never, async () => ({ session: { user: { id: 1 } } }), 'identity');
    const shirabe = await ssrAuthFetch(
      event as never,
      async () => ({ user: { shirabe: { linked: true } } }),
      'shirabe',
    );

    expect(identity).toEqual({ session: { user: { id: 1 } } });
    expect(shirabe).toEqual({ user: { shirabe: { linked: true } } });
  });

  it('still caches within a scope, which is what it is for', async () => {
    const event = fakeEvent(SIGNED_IN);
    const fetcher = vi.fn(async () => ({ user: { id: 1 } }));

    await ssrAuthFetch(event as never, fetcher, 'shirabe');
    await ssrAuthFetch(event as never, fetcher, 'shirabe');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('drops every scope for the session', async () => {
    const event = fakeEvent(SIGNED_IN);
    const identity = vi.fn(async () => ({ a: 1 }));
    const shirabe = vi.fn(async () => ({ b: 2 }));
    await ssrAuthFetch(event as never, identity, 'identity');
    await ssrAuthFetch(event as never, shirabe, 'shirabe');

    dropSessionEntries(event as never);

    await ssrAuthFetch(event as never, identity, 'identity');
    await ssrAuthFetch(event as never, shirabe, 'shirabe');
    expect(identity).toHaveBeenCalledTimes(2);
    expect(shirabe).toHaveBeenCalledTimes(2);
  });
});

// Separate anonymous renders from signed-in cache hits; otherwise observed signed-in latency describes misses only.
describe('lookup counter', () => {
  const SIGNED_IN = 'nadeshiko.session_token=tok1';

  it('separates the miss that pays for a backend call from the hit that does not', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);

    expect(outcomes()).toEqual(['miss', 'hit']);
  });

  // Concurrent joins save work through deduplication, not TTL hits.
  it('counts a joined in-flight build as coalesced', async () => {
    let release: (v: unknown) => void = () => {};
    const fetcher = vi.fn(() => new Promise((resolve) => (release = resolve)));

    const first = ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);
    const second = ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);
    release({ ok: true });
    await Promise.all([first, second]);

    expect(outcomes()).toEqual(['miss', 'coalesced']);
  });

  it('records the miss even when the backend call throws', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('auth down'));
    await expect(ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher)).rejects.toThrow('auth down');

    expect(outcomes()).toEqual(['miss']);
  });

  it('records the cookie-less render that never reaches the cache', () => {
    recordAnonymousRender();
    expect(outcomes()).toEqual(['anonymous']);
  });

  it('tags each lookup with its scope, so the two callers can be told apart', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher, 'identity');
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher, 'shirabe');

    expect(adds.map((a) => a.attributes.scope)).toEqual(['identity', 'shirabe']);
    expect(adds.every((a) => a.value === 1)).toBe(true);
  });
});
