import { describe, it, expect } from 'vitest';
import { ipRateLimit, _resetForTests } from './ipRateLimit';

function fakeEvent(headers: Record<string, string | undefined>, ip = '1.2.3.4') {
  return {
    node: { req: { socket: { remoteAddress: ip }, headers } },
    headers,
  } as any;
}

describe('ipRateLimit', () => {
  it('returns null when under the limit', async () => {
    _resetForTests();
    const ev = fakeEvent({});
    for (let i = 0; i < 5; i++) {
      const res = await ipRateLimit(ev, { windowMs: 60_000, max: 5 });
      expect(res).toBeNull();
    }
  });

  it('returns a 429 response when over the limit', async () => {
    _resetForTests();
    const ev = fakeEvent({});
    for (let i = 0; i < 3; i++) {
      await ipRateLimit(ev, { windowMs: 60_000, max: 3 });
    }
    const res = await ipRateLimit(ev, { windowMs: 60_000, max: 3 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  it('keys buckets by x-forwarded-for when present', async () => {
    _resetForTests();
    const a = fakeEvent({ 'x-forwarded-for': '5.6.7.8' });
    const b = fakeEvent({ 'x-forwarded-for': '9.10.11.12' });
    for (let i = 0; i < 3; i++) await ipRateLimit(a, { windowMs: 60_000, max: 3 });
    // a is full, b is still allowed
    expect(await ipRateLimit(a, { windowMs: 60_000, max: 3 })).not.toBeNull();
    expect(await ipRateLimit(b, { windowMs: 60_000, max: 3 })).toBeNull();
  });

  it('falls back to socket remoteAddress when no x-forwarded-for', async () => {
    _resetForTests();
    const a = fakeEvent({}, '13.14.15.16');
    const b = fakeEvent({}, '17.18.19.20');
    for (let i = 0; i < 3; i++) await ipRateLimit(a, { windowMs: 60_000, max: 3 });
    expect(await ipRateLimit(a, { windowMs: 60_000, max: 3 })).not.toBeNull();
    expect(await ipRateLimit(b, { windowMs: 60_000, max: 3 })).toBeNull();
  });

  it('isolates buckets per (key, route) tuple', async () => {
    _resetForTests();
    const a = fakeEvent({});
    for (let i = 0; i < 3; i++) await ipRateLimit(a, { windowMs: 60_000, max: 3, route: '/v1/auth' });
    // Different route = different bucket
    expect(await ipRateLimit(a, { windowMs: 60_000, max: 3, route: '/v1/search' })).toBeNull();
  });

  it('window expires and bucket resets', async () => {
    _resetForTests();
    const ev = fakeEvent({});
    for (let i = 0; i < 3; i++) await ipRateLimit(ev, { windowMs: 50, max: 3 });
    expect(await ipRateLimit(ev, { windowMs: 50, max: 3 })).not.toBeNull();
    await new Promise((r) => setTimeout(r, 70));
    expect(await ipRateLimit(ev, { windowMs: 50, max: 3 })).toBeNull();
  });
});
