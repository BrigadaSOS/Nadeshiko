import 'dotenv/config';
import { describe, it, expect } from 'bun:test';
import express from 'express';
import request from 'supertest';
import { globalRateLimit, authRateLimit } from '@app/middleware/rateLimit';
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

  it('returns 429 with the expected body once the global limit is exceeded', async () => {
    const app = buildApp();
    const max = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
    let last: request.Response | undefined;
    for (let i = 0; i < max + 2; i++) {
      last = await request(app).get('/ping').set('X-Forwarded-For', '9.9.9.9');
    }
    expect(last?.status).toBe(429);
    expect(last?.body).toMatchObject({ error: 'rate_limited' });
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
