import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dropSessionEntries, hasSessionCookie, ssrAuthFetch, _resetForTests } from './ssrAuthCache';

beforeEach(() => _resetForTests());

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
   * the very next render, and deleting the entry could only ever have worked in
   * the worker that served the write -- production forks three of them, each
   * with its own copy of this map. The cookie rides the request instead, so
   * every worker misses.
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
    vi.advanceTimersByTime(31_000);
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
