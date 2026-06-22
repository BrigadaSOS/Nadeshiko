import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ssrAuthFetch, _resetForTests } from './ssrAuthCache';

beforeEach(() => _resetForTests());

function fakeEvent(cookieHeader?: string, ip = '1.2.3.4') {
  return {
    node: { req: { socket: { remoteAddress: ip }, headers: { cookie: cookieHeader } } },
    headers: { cookie: cookieHeader },
  } as any;
}

describe('ssrAuthFetch', () => {
  it('returns the upstream response and caches it', async () => {
    const fetcher = vi.fn().mockResolvedValue({ user: { id: 1, name: 'alice' } });
    const r1 = await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    const r2 = await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    expect(r1).toEqual({ user: { id: 1, name: 'alice' } });
    expect(r2).toEqual({ user: { id: 1, name: 'alice' } });
    expect(fetcher).toHaveBeenCalledTimes(1); // coalesced!
  });

  it('does NOT coalesce across different session tokens', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok1'), fetcher);
    await ssrAuthFetch(fakeEvent('nadeshiko.session_token=tok2'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does NOT coalesce across different anonymous IPs', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await ssrAuthFetch(fakeEvent(undefined, '1.1.1.1'), fetcher);
    await ssrAuthFetch(fakeEvent(undefined, '2.2.2.2'), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('coalesces anonymous requests from the same IP', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await Promise.all([
      ssrAuthFetch(fakeEvent(undefined, '5.5.5.5'), fetcher),
      ssrAuthFetch(fakeEvent(undefined, '5.5.5.5'), fetcher),
      ssrAuthFetch(fakeEvent(undefined, '5.5.5.5'), fetcher),
    ]);
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
    await expect(ssrAuthFetch(fakeEvent('nadeshiko.session_token=tokZ'), fetcher)).rejects.toThrow(
      'upstream down',
    );
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
