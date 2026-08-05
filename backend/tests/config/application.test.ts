import { request } from '../helpers/http';
import { describe, expect, it } from 'vitest';
import { buildApplication } from '@config/application';

describe('buildApplication', () => {
  it('mounts default routes when no custom route mounter is provided', async () => {
    const app = buildApplication();
    const res = await request(app).get('/up');

    // /up probes the app DataSource, which the suite never initializes (tests
    // run against TestDataSource), so it honestly reports the database as down.
    // The health envelope is what proves the route is mounted -- the custom
    // route mounter case below gets a 404 instead.
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', database: 'down' });
  });

  it('uses custom route mounter when provided', async () => {
    const app = buildApplication({
      mountRoutes: (instance) => {
        instance.get('/custom', (_req, res) => res.status(201).json({ ok: true }));
      },
    });

    const customRes = await request(app).get('/custom');
    expect(customRes.status).toBe(201);
    expect(customRes.body).toMatchObject({ ok: true });

    const upRes = await request(app).get('/up');
    expect(upRes.status).toBe(404);
  });

  it('runs pre-route middleware before custom routes', async () => {
    const app = buildApplication({
      beforeRoutes: [
        (req, _res, next) => {
          (req as any).fromBeforeRoutes = 'ok';
          next();
        },
      ],
      mountRoutes: (instance) => {
        instance.get('/probe', (req, res) => {
          res.status(200).json({ fromBeforeRoutes: (req as any).fromBeforeRoutes || null });
        });
      },
    });

    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fromBeforeRoutes: 'ok' });
  });

  it('can disable the global rate limiter for isolated application tests', async () => {
    const app = buildApplication({
      rateLimit: false,
      mountRoutes: (instance) => {
        instance.get('/unlimited', (_req, res) => res.status(200).json({ ok: true }));
      },
    });

    // One server for all 302 requests. `request(app)` binds a fresh ephemeral
    // server per call, and 302 of those under a loaded full-suite run exhausted
    // sockets often enough to fail this test with ETIMEDOUT roughly one run in
    // five -- a flake in the harness, not in the limiter being tested.
    const server = app.listen(0);
    try {
      let lastStatus = 0;
      for (let i = 0; i < 302; i++) {
        lastStatus = (await request(server).get('/unlimited').set('X-Forwarded-For', '203.0.113.77')).status;
      }

      expect(lastStatus).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it('returns catch-all 404 with request instance id', async () => {
    const app = buildApplication({
      mountRoutes: (instance) => {
        instance.get('/known', (_req, res) => res.status(200).send('ok'));
      },
    });

    const res = await request(app).get('/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(typeof res.body.instance).toBe('string');
    expect(res.body.instance.startsWith('nade-')).toBe(true);
  });
});
