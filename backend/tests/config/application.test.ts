import request from 'supertest';
import { describe, expect, it } from 'bun:test';
import { buildApplication } from '@config/application';

describe('buildApplication', () => {
  it('mounts default routes when no custom route mounter is provided', async () => {
    const app = buildApplication();
    const res = await request(app).get('/up');

    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
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
