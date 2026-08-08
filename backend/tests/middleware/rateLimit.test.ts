import { describe, it, expect } from 'vitest';
import { type Server } from 'node:http';
import { type Application } from 'express';
import { request } from '../helpers/http';
import type { Response as SupertestResponse } from 'supertest';
import { authRateLimit, isPrivateAddress } from '@app/middleware/rateLimit';
import { setCachedApiKey } from '@app/middleware/authCacheStore';
import { buildApplication } from '@config/application';
import { config } from '@config/config';
import { ApiKeyKind } from '@app/models';

// Built through buildApplication so the limiters sit where production puts
// them: globalRateLimit ahead of body parsing and the router, authRateLimit
// scoped to /v1/auth ahead of the auth handlers. Both therefore run BEFORE any
// route-level auth middleware, which is exactly what the SERVICE-key exemption
// has to cope with. Stub handlers stand in for the real routers so the limiter
// behaviour is not entangled with better-auth or the database.
function buildApp(): Application {
  return buildApplication({
    mountRoutes: (app) => {
      app.use('/v1/auth', authRateLimit);
      app.get('/v1/auth/get-session', (_req, res) => {
        res.json({ ok: true });
      });
      app.get('/ping', (_req, res) => {
        res.json({ ok: true });
      });
    },
  });
}

// Runs the body against one listening server rather than the fresh one
// supertest starts per `request(app)` call. Exercising a limit means firing
// hundreds of sequential requests, and that much listen/close churn
// intermittently exhausts sockets and fails the request with ECONNREFUSED.
async function withServer<T>(fn: (server: Server) => Promise<T>): Promise<T> {
  const server = buildApp().listen(0);
  try {
    return await fn(server);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

describe('rateLimit', () => {
  it('allows requests under the limit', async () => {
    await withServer(async (server) => {
      for (let i = 0; i < 5; i++) {
        const res = await request(server).get('/ping').set('X-Forwarded-For', '1.2.3.4');
        expect(res.status).toBe(200);
      }
    });
  });

  it('returns 429 in the standard error envelope once the global limit is exceeded', async () => {
    await withServer(async (server) => {
      const max = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;
      let last: SupertestResponse | undefined;
      for (let i = 0; i < max + 2; i++) {
        last = await request(server).get('/ping').set('X-Forwarded-For', '9.9.9.9');
      }
      expect(last?.status).toBe(429);
      expect(last?.body).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED', status: 429 });
      expect(last?.headers['retry-after']).toBeDefined();
    });
  }, 15_000);

  it('groups IPv6 addresses in the same /56 into one rate-limit bucket', async () => {
    await withServer(async (server) => {
      const max = config.RATE_LIMIT_MAX_REQUESTS_PER_IP;

      for (let i = 0; i < max; i++) {
        const response = await request(server).get('/ping').set('X-Forwarded-For', '2001:db8:abcd:1200::1');
        expect(response.status).toBe(200);
      }

      const sameSubnetResponse = await request(server).get('/ping').set('X-Forwarded-For', '2001:db8:abcd:12ff::2');
      const differentSubnetResponse = await request(server)
        .get('/ping')
        .set('X-Forwarded-For', '2001:db8:abcd:1300::1');

      expect(sameSubnetResponse.status).toBe(429);
      expect(differentSubnetResponse.status).toBe(200);
    });
  }, 15_000);

  it('groups IPv6 addresses in the same /56 for auth routes without affecting adjacent subnets', async () => {
    await withServer(async (server) => {
      for (let i = 0; i < config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP; i++) {
        const response = await request(server)
          .get('/v1/auth/get-session')
          .set('X-Forwarded-For', '2001:db8:abcd:3400::1');
        expect(response.status).toBe(200);
      }

      const sameSubnetResponse = await request(server)
        .get('/v1/auth/get-session')
        .set('X-Forwarded-For', '2001:db8:abcd:34ff::2');
      const differentSubnetResponse = await request(server)
        .get('/v1/auth/get-session')
        .set('X-Forwarded-For', '2001:db8:abcd:3500::1');

      expect(sameSubnetResponse.status).toBe(429);
      expect(differentSubnetResponse.status).toBe(200);
    });
  }, 15_000);

  it('exempts proxied traffic carrying the valid internal-proxy secret', async () => {
    // The frontend Nitro proxy is already rate limited per real client IP, and
    // all its traffic shares one source key at the backend. It proves itself
    // with the shared secret so the backend does not throttle every proxied user
    // against one bucket.
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 50; i++) {
        const r = await request(server)
          .get('/ping')
          .set('X-Forwarded-For', '172.18.0.9')
          .set('x-internal-proxy-auth', config.INTERNAL_PROXY_SECRET ?? '');
        statuses.push(r.status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
    });
  }, 15_000);

  it('does NOT exempt traffic with a wrong/forged internal-proxy secret', async () => {
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server)
          .get('/ping')
          .set('X-Forwarded-For', '5.5.5.5')
          .set('x-internal-proxy-auth', 'not-the-secret');
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  }, 15_000);

  it('counts one visitor as one bucket even when Cloudflare routes them via different edges', async () => {
    // The production bug this replaced. `trust proxy: 1` resolved req.ip to the
    // rightmost X-Forwarded-For entry, which is the Cloudflare edge and not the
    // visitor. Twelve requests from one machine landed in four buckets, each
    // reporting remaining=299, so an abusive client was never counted twice.
    // Here the visitor is constant and the edge rotates on every request.
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server)
          .get('/ping')
          .set('CF-Connecting-IP', '203.0.113.7')
          .set('X-Forwarded-For', `203.0.113.7, 172.68.${i % 200}.9`);
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  }, 20_000);

  it('does not collapse different visitors sharing one Cloudflare edge', async () => {
    // The mirror failure of the same bug: unrelated people behind one edge were
    // counted against each other. Same edge, different visitors, no throttling.
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server)
          .get('/ping')
          .set('CF-Connecting-IP', `198.51.100.${i % 250}`)
          .set('X-Forwarded-For', '198.51.100.1, 172.68.23.139');
        statuses.push(r.status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
    });
  }, 20_000);

  it('does NOT exempt traffic that sends no internal-proxy secret at all', async () => {
    // The state this was actually found in: the SSR SDK reached the backend
    // with a service API key but no secret, so every render competed for one
    // bucket keyed on the frontend container's address. "Wrong secret" was
    // already covered; "no secret" is the case that shipped.
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server).get('/ping').set('X-Forwarded-For', '172.18.0.9');
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  }, 15_000);

  it('auth route is separately (more tightly) rate-limited', async () => {
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP + 10; i++) {
        const r = await request(server).get('/v1/auth/get-session').set('X-Forwarded-For', '7.7.7.7');
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
      // The auth limit is tighter than the global one, so it must trip first.
      expect(statuses.indexOf(429)).toBeLessThan(config.RATE_LIMIT_MAX_REQUESTS_PER_IP);
    });
  }, 15_000);
});

describe('rateLimit skip for SERVICE keys', () => {
  // The limiters run before route-level auth, so `req.auth` is not populated
  // yet. The exemption instead resolves the bearer token against the auth cache
  // that requireApiKeyAuth fills in — seeded here the way a verified key would
  // leave it.
  const SERVICE_KEY = 'nade_service_key_for_rate_limit_test';
  const USER_KEY = 'nade_user_key_for_rate_limit_test';

  function seedKeys(): void {
    setCachedApiKey(SERVICE_KEY, {
      userId: 1,
      apiKeyId: 'service-key-id',
      apiKeyKind: ApiKeyKind.SERVICE,
      permissions: [],
    });
    setCachedApiKey(USER_KEY, {
      userId: 2,
      apiKeyId: 'user-key-id',
      apiKeyKind: ApiKeyKind.USER,
      permissions: [],
    });
  }

  it('never rate-limits SERVICE key requests (global)', async () => {
    seedKeys();
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 50; i++) {
        const r = await request(server)
          .get('/ping')
          .set('X-Forwarded-For', '8.8.8.8')
          .set('Authorization', `Bearer ${SERVICE_KEY}`);
        statuses.push(r.status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
    });
  }, 15_000);

  it('never rate-limits SERVICE key requests (auth)', async () => {
    seedKeys();
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_AUTH_MAX_REQUESTS_PER_IP + 50; i++) {
        const r = await request(server)
          .get('/v1/auth/get-session')
          .set('X-Forwarded-For', '8.8.4.4')
          .set('Authorization', `Bearer ${SERVICE_KEY}`);
        statuses.push(r.status);
      }
      expect(statuses.every((s) => s === 200)).toBe(true);
    });
  }, 15_000);

  it('still rate-limits USER key requests', async () => {
    seedKeys();
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server)
          .get('/ping')
          .set('X-Forwarded-For', '8.8.5.5')
          .set('Authorization', `Bearer ${USER_KEY}`);
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  }, 15_000);

  it('does NOT exempt an unrecognised bearer token', async () => {
    await withServer(async (server) => {
      const statuses: number[] = [];
      for (let i = 0; i < config.RATE_LIMIT_MAX_REQUESTS_PER_IP + 2; i++) {
        const r = await request(server)
          .get('/ping')
          .set('X-Forwarded-For', '8.8.6.6')
          .set('Authorization', 'Bearer not-a-real-key');
        statuses.push(r.status);
      }
      expect(statuses).toContain(429);
    });
  }, 15_000);
});

describe('isPrivateAddress', () => {
  // The NadeshikoBackendProdRateLimitingItself alert fires on the `source`
  // label this produces, so a wrong answer here is a silently missing alert
  // rather than a visible failure.
  it('recognises the container network, loopback and the RFC1918 ranges', () => {
    for (const ip of ['172.18.0.4', '172.18.0.9', '10.0.0.1', '192.168.1.5', '127.0.0.1', '::1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('unwraps IPv4-mapped IPv6, which is how Express reports these', () => {
    // `::ffff:172.18.0.9` is the same address as `172.18.0.9`; missing this
    // would classify every internal 429 as external and mute the alert.
    expect(isPrivateAddress('::ffff:172.18.0.9')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('does not treat public addresses as internal', () => {
    // 172.32/172.15 sit just outside 172.16/12 and are the boundary the
    // regex exists to get right.
    for (const ip of ['8.8.8.8', '203.0.113.7', '172.32.0.1', '172.15.0.1', undefined]) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});
