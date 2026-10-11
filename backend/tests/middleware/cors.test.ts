import { describe, it, expect, vi } from 'vitest';
import type { Application, RequestHandler } from 'express';
import { request } from '../helpers/http';
import { buildApplication } from '@config/application';

// Build through `buildApplication` so CORS is tested in production order, before rate limiting; stub routes isolate
// header policy from route behavior.
function buildApp(rateLimit?: RequestHandler): Application {
  return buildApplication({
    rateLimit: rateLimit ?? false,
    mountRoutes: (app) => {
      app.post('/v1/search', (_req, res) => {
        res.json({ ok: true });
      });
      app.get('/v1/media/segments/:segmentPublicId/context', (_req, res) => {
        res.json({ ok: true });
      });
      app.get('/v1/user/me', (_req, res) => {
        res.json({ ok: true });
      });
      app.post('/v1/auth/sign-in/social', (_req, res) => {
        res.json({ ok: true });
      });
    },
  });
}

const ORIGIN = 'http://localhost:5173';

describe('corsPolicy', () => {
  describe('public corpus routes', () => {
    it('answers a preflight for a public route', async () => {
      const res = await request(buildApp())
        .options('/v1/search')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('Authorization');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-max-age']).toBe('86400');
    });

    it('allows any origin, including the ones a self-hosted copy sends', async () => {
      // `null` is a real origin from `file://` pages and sandboxed iframes, not a missing header; the policy must
      // handle it explicitly.
      for (const origin of ['https://example.org', 'http://127.0.0.1:8080', 'null']) {
        const res = await request(buildApp()).post('/v1/search').set('Origin', origin);

        expect(res.headers['access-control-allow-origin']).toBe('*');
      }
    });

    // The allowlist stores OpenAPI templates while requests use concrete paths; this matcher connects them.
    it('matches a templated path', async () => {
      const res = await request(buildApp())
        .options('/v1/media/segments/V1StGXR8_Z5d/context')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    // curl works, the browser says "CORS" and neither side says why. Cheap to
    // support, miserable to debug if unsupported.
    it('tolerates a trailing slash', async () => {
      const res = await request(buildApp()).post('/v1/search/').set('Origin', ORIGIN);

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    it('exposes the rate-limit headers a client needs to back off', async () => {
      const res = await request(buildApp()).post('/v1/search').set('Origin', ORIGIN);

      const exposed = res.headers['access-control-expose-headers'] ?? '';
      expect(exposed).toContain('Retry-After');
      expect(exposed).toContain('RateLimit');
    });
  });

  describe('everything else', () => {
    it('does not make owner-scoped routes cross-origin readable', async () => {
      const res = await request(buildApp())
        .options('/v1/user/me')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not make the auth routes cross-origin readable', async () => {
      const res = await request(buildApp())
        .options('/v1/auth/sign-in/social')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('refuses a preflight naming a method the public route does not allow', async () => {
      const res = await request(buildApp())
        .options('/v1/search')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'DELETE');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    // With credentials enabled, allow-all origins let any visited page read signed-in account data.
    it('never allows credentials', async () => {
      const preflight = await request(buildApp())
        .options('/v1/search')
        .set('Origin', ORIGIN)
        .set('Access-Control-Request-Method', 'POST');
      const actual = await request(buildApp()).post('/v1/search').set('Origin', ORIGIN);

      expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();
      expect(actual.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  // Do not charge preflight requests to the shared per-IP bucket: CGNAT users would pay for browser protocol overhead.
  it('does not spend the per-IP rate limit on a preflight', async () => {
    const limiter = vi.fn<RequestHandler>((_req, _res, next) => next());
    const app = buildApp(limiter);

    await request(app).options('/v1/search').set('Origin', ORIGIN).set('Access-Control-Request-Method', 'POST');
    expect(limiter).not.toHaveBeenCalled();

    await request(app).post('/v1/search').set('Origin', ORIGIN);
    expect(limiter).toHaveBeenCalledTimes(1);
  });
});
