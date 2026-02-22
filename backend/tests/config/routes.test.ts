import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'bun:test';

const { mountRoutes, noCache } = await import('@config/routes');

describe('noCache', () => {
  it('sets no-store cache headers and calls next()', () => {
    const res = {
      setHeader: vi.fn(),
    };
    const next = vi.fn();

    noCache({} as any, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('CDN-Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('mountRoutes', () => {
  it('mounts health and auth routes', async () => {
    const app = express();
    const mounted = mountRoutes(app);

    expect(mounted).toBe(app);

    const upRes = await request(app).get('/up');
    expect(upRes.status).toBe(200);
    expect(upRes.text).toBe('OK');

    const authRes = await request(app).get('/v1/auth');
    expect(authRes.status).not.toBe(500);
    expect(authRes.headers['cache-control']).toBe('no-store');
    expect(authRes.headers['cdn-cache-control']).toBe('no-store');

    const splatRes = await request(app).post('/v1/auth/token');
    expect(splatRes.status).not.toBe(500);
    expect(splatRes.headers['cache-control']).toBe('no-store');
    expect(splatRes.headers['cdn-cache-control']).toBe('no-store');
  });
});
