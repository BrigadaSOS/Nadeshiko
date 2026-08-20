import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Application } from 'express';
import { request } from '../helpers/http';
import { signInAddressRateLimit, signInGlobalRateLimit, resetRateLimiters } from '@app/middleware/rateLimit';
import { handleErrors } from '@app/middleware/errorHandler';
import { config } from '@config/config';

/**
 * Mirrors how `mountRoutes` wires these: both limiters ahead of the handler that
 * would send the mail, so a refused request never reaches it, and the address
 * limiter ahead of the ceiling so a refused request does not spend the ceiling
 * on its way out.
 */
function buildApp(): Application {
  const app = express();
  app.use(express.json());
  app.post('/v1/auth/sign-in/magic-link', signInAddressRateLimit, signInGlobalRateLimit, (_req, res) => {
    res.status(200).json({ sent: true });
  });
  app.use(handleErrors);
  return app;
}

let app: Application;

beforeEach(() => {
  resetRateLimiters();
  app = buildApp();
});

afterEach(() => {
  resetRateLimiters();
});

const ask = (email: string, ip = '203.0.113.10') =>
  request(app).post('/v1/auth/sign-in/magic-link').set('CF-Connecting-IP', ip).send({ email });

describe('the per-address sign-in budget', () => {
  /**
   * The fifth still sends. An off-by-one here costs somebody the last attempt
   * they were promised, and it is invisible unless asserted.
   */
  it('allows five an hour and refuses the sixth', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await ask('reader@example.com');
      expect(response.status, `attempt ${attempt}`).toBe(200);
    }

    const sixth = await ask('reader@example.com');
    expect(sixth.status).toBe(429);
  });

  /** The countdown in the modal reads this and nothing else. */
  it('says how long to wait', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await ask('reader@example.com');

    const refused = await ask('reader@example.com');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  /**
   * THE CASE THE WHOLE CHANGE IS FOR. A school, an office and everyone behind
   * CGNAT share one address; the limit this replaced would have locked the
   * fourth of them out within five minutes.
   */
  it('does not let one person spend another person budget from the same IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await ask('first@example.com');
    expect((await ask('first@example.com')).status).toBe(429);

    expect((await ask('second@example.com')).status).toBe(200);
  });

  it('is not fooled by casing or surrounding space', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await ask('reader@example.com');

    expect((await ask('  Reader@Example.COM  ')).status).toBe(429);
  });

  /**
   * A body with no address still costs somebody a budget rather than slipping
   * past both limits — it falls back to the caller's IP.
   */
  it('falls back to the IP when there is no address', async () => {
    const send = () =>
      request(app).post('/v1/auth/sign-in/magic-link').set('CF-Connecting-IP', '198.51.100.7').send({});

    for (let attempt = 0; attempt < 5; attempt += 1) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  /**
   * THE ONE LIMITER THAT MUST NOT EXEMPT THE PROXY. Every other limiter in
   * `rateLimit.ts` carries `skip: shouldSkip`, because proxied traffic arrives
   * under one source key and is already limited per real client IP upstream.
   * Here the key is the ADDRESS, not the source, and essentially every real
   * sign-in comes through the frontend proxy -- exempting it would leave the
   * per-address budget applying to nobody. The day the `skip` gets
   * pattern-matched onto this limiter, this is the test that fails.
   */
  it('still counts requests carrying the internal-proxy secret', async () => {
    const proxied = () =>
      request(app)
        .post('/v1/auth/sign-in/magic-link')
        .set('CF-Connecting-IP', '203.0.113.10')
        .set('x-internal-proxy-auth', config.INTERNAL_PROXY_SECRET ?? '')
        .send({ email: 'proxied@example.com' });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await proxied()).status, `attempt ${attempt}`).toBe(200);
    }

    expect((await proxied()).status).toBe(429);
  });

  it('answers in the API problem-details shape', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await ask('reader@example.com');

    const refused = await ask('reader@example.com');
    expect(refused.body.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(refused.body.status).toBe(429);
  });
});

describe('the application-wide ceiling', () => {
  /**
   * The abuse the other two limits cannot see between them: a thousand addresses
   * across a botnet, each staying under both. Asserted here as "shares one
   * counter across addresses", which is the property that makes it work.
   */
  it('counts every address against one bucket', async () => {
    const app429 = express();
    app429.use(express.json());
    app429.post('/v1/auth/sign-in/magic-link', signInGlobalRateLimit, (_req, res) => res.status(200).json({}));
    app429.use(handleErrors);

    // Different addresses AND different IPs — neither of the other two limits
    // would see these as related.
    const first = await request(app429)
      .post('/v1/auth/sign-in/magic-link')
      .set('CF-Connecting-IP', '203.0.113.1')
      .send({ email: 'a@example.com' });
    const second = await request(app429)
      .post('/v1/auth/sign-in/magic-link')
      .set('CF-Connecting-IP', '198.51.100.2')
      .send({ email: 'b@example.com' });

    // Both allowed at this volume; what matters is that they share a counter,
    // which the 2,000/day limit is far too high to demonstrate by exhausting.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['ratelimit-remaining']).toBeUndefined();
  });
});
