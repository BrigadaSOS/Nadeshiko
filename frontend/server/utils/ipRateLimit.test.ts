import { describe, it, expect } from 'vitest';
import { ipRateLimit, perWorkerMax, _resetForTests } from './ipRateLimit';

function fakeEvent(headers: Record<string, string | undefined>, ip = '1.2.3.4') {
  return {
    node: { req: { socket: { remoteAddress: ip }, headers }, res: { setHeader: () => {} } },
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
    expect(res?.statusCode).toBe(429);
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

  it('prefers cf-connecting-ip over a client-supplied x-forwarded-for', async () => {
    // The bypass this closes: X-Forwarded-For is append-only and Cloudflare
    // honours that, so a client that sends its own owns the leftmost entry.
    // Rotating it once per request used to mint a fresh bucket every time --
    // the limiter counted diligently and never counted the same visitor twice.
    _resetForTests();
    const opts = { windowMs: 60_000, max: 3 };
    const rotating = (n: number) => fakeEvent({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': `10.0.0.${n}` });

    for (let i = 0; i < 3; i++) await ipRateLimit(rotating(i), opts);

    // Same visitor as far as Cloudflare is concerned, so the bucket is spent
    // however many different XFF values they rotated through.
    expect(await ipRateLimit(rotating(99), opts)).not.toBeNull();
  });

  it('still separates genuinely different visitors behind Cloudflare', async () => {
    // The mirror of the case above: preferring cf-connecting-ip must not
    // collapse everyone arriving through the edge onto one bucket.
    _resetForTests();
    const opts = { windowMs: 60_000, max: 3 };
    const a = fakeEvent({ 'cf-connecting-ip': '203.0.113.7' });
    const b = fakeEvent({ 'cf-connecting-ip': '198.51.100.4' });

    for (let i = 0; i < 3; i++) await ipRateLimit(a, opts);

    expect(await ipRateLimit(a, opts)).not.toBeNull();
    expect(await ipRateLimit(b, opts)).toBeNull();
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

describe('perWorkerMax', () => {
  it('is the whole limit outside cluster mode', () => {
    // The deployed reality: `nuxt.config.ts` pins `preset: 'node-server'`, so
    // `NITRO_CLUSTER_WORKERS` in the deploy file never forks anything and the
    // single process owns the entire budget.
    expect(perWorkerMax(60)).toBe(60);
  });

  it('ignores NITRO_CLUSTER_WORKERS when no worker was actually forked', () => {
    // This is the whole point. Production carried `NITRO_CLUSTER_WORKERS=3` for
    // months against one process, and the limits had been pre-divided by three
    // to match -- so every limit enforced a third of its documented value.
    // Trusting the variable is what made that possible; `cluster.isWorker` is
    // not something a stale env var can fake.
    const previous = process.env.NITRO_CLUSTER_WORKERS;
    process.env.NITRO_CLUSTER_WORKERS = '3';
    try {
      expect(perWorkerMax(60)).toBe(60);
    } finally {
      if (previous === undefined) delete process.env.NITRO_CLUSTER_WORKERS;
      else process.env.NITRO_CLUSTER_WORKERS = previous;
    }
  });

  it('never rounds a limit down to nothing', () => {
    // Rounding down would make the real ceiling quietly stricter than the number
    // asked for, which is the failure this exists to stop repeating.
    expect(perWorkerMax(1)).toBeGreaterThanOrEqual(1);
    expect(perWorkerMax(2)).toBeGreaterThanOrEqual(1);
  });

  it('advertises the share it will actually enforce', async () => {
    _resetForTests();
    const ev = fakeEvent({});
    const headers: Record<string, string> = {};
    ev.node.res.setHeader = (name: string, value: string) => {
      headers[name] = value;
    };

    await ipRateLimit(ev, { windowMs: 60_000, max: 60 });

    // Promising the service-wide total would advertise headroom a client pinned
    // to one worker never gets.
    expect(headers['X-RateLimit-Limit']).toBe(String(perWorkerMax(60)));
  });
});
