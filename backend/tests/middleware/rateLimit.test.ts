import 'dotenv/config';
import { describe, it, expect } from 'bun:test';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { globalRateLimit, authRateLimit } from '@app/middleware/rateLimit';
import { handleErrors } from '@app/middleware/errorHandler';
import { config } from '@config/config';
import { ApiKeyKind, AuthType } from '@app/models';

function buildApp(): express.Application {
  const app = express();
  app.set('trust proxy', 1);
  app.use(globalRateLimit);
  app.use('/v1/auth', authRateLimit, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(handleErrors as ErrorRequestHandler);
  return app;
}

describe('rateLimit', () => {
  it('allows requests under the limit', async () => {
    const app = buildApp();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/ping').set('X-Forwarded-For', '1.2.3.4');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 in the standard error envelope once the global limit is exceeded', async () => {
    const app = buildApp();
    const max = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
    let last: request.Response | undefined;
    for (let i = 0; i < max + 2; i++) {
      last = await request(app).get('/ping').set('X-Forwarded-For', '9.9.9.9');
    }
    expect(last?.status).toBe(429);
    expect(last?.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
    expect(last?.headers['retry-after']).toBeDefined();
  });

  it('exempts proxied traffic carrying the valid internal-proxy secret', async () => {
    const app = buildApp();
    // The frontend Nitro proxy is already rate limited per real client IP, and
    // all its traffic shares one source key at the backend. It proves itself
    // with the shared secret so the backend does not throttle every proxied user
    // against one bucket.
    const statuses: number[] = [];
    for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 50; i++) {
      const r = await request(app)
        .get('/ping')
        .set('X-Forwarded-For', '172.18.0.9')
        .set('x-internal-proxy-auth', config.INTERNAL_PROXY_SECRET ?? '');
      statuses.push(r.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('does NOT exempt traffic with a wrong/forged internal-proxy secret', async () => {
    const app = buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
      const r = await request(app)
        .get('/ping')
        .set('X-Forwarded-For', '5.5.5.5')
        .set('x-internal-proxy-auth', 'not-the-secret');
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
  });

  it('auth route is separately (more tightly) rate-limited', async () => {
    const app = buildApp();
    const statuses: number[] = [];
    for (let i = 0; i < config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP + 10; i++) {
      const r = await request(app).get('/v1/auth/get-session').set('X-Forwarded-For', '7.7.7.7');
      statuses.push(r.status);
    }
    expect(statuses).toContain(429);
    // The auth limit is tighter than the global one, so it must trip first.
    expect(statuses.indexOf(429)).toBeLessThan(config.RATE_LIMIT_MAX_REQUESTS_PER_IP);
  });
});

describe('rateLimit skip for SERVICE keys', () => {
  function buildServiceKeyApp(): express.Application {
    const app = express();
    app.set('trust proxy', 1);
    // Inject a SERVICE-key auth payload BEFORE the limiters, mimicking what the
    // authentication middleware does for server-to-server requests.
    app.use((req, _res, next) => {
      req.auth = {
        type: AuthType.API_KEY,
        apiKey: { kind: ApiKeyKind.SERVICE, permissions: [] },
      };
      next();
    });
    app.use(globalRateLimit);
    app.use('/v1/auth', authRateLimit, (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('never rate-limits SERVICE key requests (global)', async () => {
    const app = buildServiceKeyApp();
    const statuses: number[] = [];
    for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 50; i++) {
      const r = await request(app).get('/ping').set('X-Forwarded-For', '8.8.8.8');
      statuses.push(r.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('never rate-limits SERVICE key requests (auth)', async () => {
    const app = buildServiceKeyApp();
    const statuses: number[] = [];
    for (let i = 0; i < config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP + 50; i++) {
      const r = await request(app).get('/v1/auth/get-session').set('X-Forwarded-For', '8.8.4.4');
      statuses.push(r.status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
