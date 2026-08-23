import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The counter is the only thing that can tell a cache hit from a render that
 * never had a session cookie, so it is worth a test rather than a hope. Mocked
 * at the API level because the module resolves its meter once, at import: a spy
 * installed later would watch an object nothing calls.
 */
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

/** The outcomes recorded so far, in order. */
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
    // An expired session is cleared by setting the cookie to nothing, which must
    // not read as "there might be a session here" and buy back the round trip.
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

  /**
   * The preferences stamp. A reader who changes a preference has to see it on
   * the very next render, and deleting the entry only works in the process that
   * served the write. The cookie rides the request instead, so any process
   * misses.
   *
   * (This used to say production forks three workers. It does not -- the preset
   * is baked in as `node-server` at build time and the `NITRO_CLUSTER_WORKERS`
   * in `deploy.prod.yml` is inert. See `PREFS_VERSION_COOKIE` for why the stamp
   * is still worth having on one process.)
   */
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
    // One write must not turn the next minute of renders into uncached ones.
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

    // The half that covers a caller with no stamp cookie to carry.
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
    // The value picks which entry is read and arrives on a cookie, so anything
    // but a `Date.now()` is ignored rather than allowed to mint its own key.
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
    // The anonymous path no longer reaches this cache at all -- `identity-auth`
    // checks `hasSessionCookie` and returns first -- so there is nothing left for
    // a per-IP key to separate, and keying on IP is what made this module care
    // about a header a client can set. A single bucket is the honest shape.
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
    // Advance just past the 60s TTL: still cached at 59_999ms, re-fetched at
    // 60_001ms. The exact boundary is what "the TTL" means -- so check both.
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

/**
 * The cache has to be ONE cache no matter how many times this module is
 * instantiated, and in this app it is instantiated twice: `ssrAuthFetch` is
 * called from `app/plugins/identity-auth.ts`, which Vite compiles into the SSR
 * bundle, while `dropSessionEntries` is called from `server/utils/backendProxy.ts`,
 * which Nitro compiles into its own. Two bundles, two copies of every
 * module-level `const`.
 *
 * That is not a hypothetical. With a plain `const store = new Map()`, the proxy
 * deleted entries out of a map nothing read, so a reader arriving without the
 * `nd-prefs-version` stamp -- a second browser, a private window, a Playwright
 * context built per test -- was served pre-change preferences for the rest of
 * the TTL. Measured against the running stack, not deduced: hiding a title and
 * re-rendering with only the session cookie still returned the title.
 *
 * `vi.resetModules()` plus a re-import is the closest a unit test gets to a
 * second bundle -- it forces a genuinely separate module instance, which is the
 * property under test.
 */
describe('one cache across module instances', () => {
  it('lets a second instance of this module see and invalidate the first one’s entries', async () => {
    const event = fakeEvent('nadeshiko.session_token=shared-tok');

    const first = await import('./ssrAuthCache');
    await first.ssrAuthFetch(event, async () => 'cached-by-first');

    vi.resetModules();
    const second = await import('./ssrAuthCache');
    expect(second).not.toBe(first);

    // Reads through: the entry the first instance wrote is served, not refetched.
    const seen = await second.ssrAuthFetch(event, async () => 'fetched-again');
    expect(seen).toBe('cached-by-first');

    // And a drop from the second instance is visible to the first, which is the
    // direction the proxy actually invalidates in.
    second.dropSessionEntries(event);
    const afterDrop = await first.ssrAuthFetch(event, async () => 'refetched');
    expect(afterDrop).toBe('refetched');
  });
});

/**
 * Two callers, two shapes, one reader.
 *
 * This cache was keyed on the session cookie alone, so `identity-auth` (which
 * stores a `{session, preferences}` bundle) and `shirabeReader` (which stores a
 * raw get-session body) shared a slot. Whichever ran first won and the other
 * read a shape it did not recognise -- and since the render always runs first,
 * the word lookup always concluded the reader had linked nothing.
 */
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

  // A preference change invalidates everything held about that reader, whatever
  // question it was answering.
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

/**
 * Before this counter, a cache hit and a cookie-less render were the same
 * observation from outside: both fast, neither logged. Every "signed-in render"
 * latency figure this project has quoted was therefore a figure about misses
 * only, with the hits it was supposed to include invisible underneath.
 */
describe('lookup counter', () => {
  const SIGNED_IN = 'nadeshiko.session_token=tok1';

  it('separates the miss that pays for a backend call from the hit that does not', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);
    await ssrAuthFetch(fakeEvent(SIGNED_IN), fetcher);

    expect(outcomes()).toEqual(['miss', 'hit']);
  });

  /**
   * A second render arriving while the first is still waiting is neither: no
   * backend call, but a concurrent render rather than a later one. Counting it
   * as a hit would credit the TTL for work the in-flight dedup did.
   */
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

    // An outage has to show up as misses. A counter that goes quiet instead
    // reads identically to nobody visiting.
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
