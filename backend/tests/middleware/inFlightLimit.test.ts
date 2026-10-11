import { describe, it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { Application, Request, Response } from 'express';
import type { Response as SupertestResponse } from 'supertest';
import { request } from '../helpers/http';
import { createInFlightLimit } from '@app/middleware/inFlightLimit';
import { buildApplication } from '@config/application';

/** Drive the cap through a real Express app so the 503 uses the production error envelope. Hold slots on promises:
 * sequential requests cannot prove an in-flight limit. */
type Deferred = { promise: Promise<void>; resolve: () => void };

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function buildApp(max: number, gate: Deferred) {
  const limit = createInFlightLimit({ scope: `test-${max}-${Math.random()}`, max });
  const app: Application = buildApplication({
    mountRoutes: (app) => {
      app.post('/v1/slow', limit, async (_req: Request, res: Response) => {
        await gate.promise;
        res.json({ ok: true });
      });
      app.post('/v1/fast', limit, (_req: Request, res: Response) => {
        res.json({ ok: true });
      });
      app.post('/v1/warm', (_req: Request, res: Response) => {
        res.json({ ok: true });
      });
    },
  });
  // Prime the listening server with one awaited request; a fire-and-forget first request can run before the helper
  // binds and never reach the limiter.
  expect((await request(app).post('/v1/warm').send({})).status).toBe(200);
  return { app, limit };
}

/** A request that has left the client and is being served right now. */
type Held = { response: Promise<SupertestResponse> };

/** Start a request with `.end()` and return its promise inside an object: awaiting the thenable would wait for the
 * held request, while the object lets the test observe it as in flight. */
async function startRequest(app: Application, path: string): Promise<Held> {
  const response = new Promise<SupertestResponse>((resolve, reject) => {
    request(app)
      .post(path)
      .send({})
      .end((error, res) => (error ? reject(error) : resolve(res)));
  });
  await new Promise((r) => setTimeout(r, 50));
  return { response };
}

describe('inFlightLimit', () => {
  it('does not admit a request that disconnected while earlier middleware was awaiting authentication', async () => {
    const authenticating = deferred();
    const authenticated = deferred();
    const disconnected = deferred();
    const reachedLimit = deferred();
    const limit = createInFlightLimit({ scope: 'test-disconnected-auth', max: 1 });
    let handled = 0;
    const app = buildApplication({
      rateLimit: false,
      mountRoutes: (app) => {
        app.post(
          '/v1/auth-race',
          async (_req, res, next) => {
            res.once('close', disconnected.resolve);
            authenticating.resolve();
            await authenticated.promise;
            next();
          },
          (req, res, next) => {
            limit(req, res, next);
            reachedLimit.resolve();
          },
          (_req, res) => {
            handled += 1;
            res.json({ ok: true });
          },
        );
        app.post('/v1/fast', limit, (_req, res) => res.json({ ok: true }));
      },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an HTTP test port');
    const client = httpRequest({ host: '127.0.0.1', port: address.port, path: '/v1/auth-race', method: 'POST' });
    client.on('error', () => {});
    try {
      client.end();
      await authenticating.promise;
      client.destroy();
      await disconnected.promise;
      authenticated.resolve();
      await reachedLimit.promise;

      expect(limit.inFlight()).toBe(0);
      expect(handled).toBe(0);
      expect((await request(server).post('/v1/fast').send({})).status).toBe(200);
    } finally {
      client.destroy();
      authenticated.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses the request past the cap with a 503 and Retry-After, and never runs the handler', async () => {
    const gate = deferred();
    const { app, limit } = await buildApp(2, gate);

    const first = await startRequest(app, '/v1/slow');
    const second = await startRequest(app, '/v1/slow');
    expect(limit.inFlight()).toBe(2);

    const refused = await request(app).post('/v1/slow').send({});
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ code: 'SERVICE_OVERLOADED', status: 503 });
    expect(refused.headers['retry-after']).toBe('2');
    expect(limit.inFlight()).toBe(2);

    gate.resolve();
    expect((await first.response).status).toBe(200);
    expect((await second.response).status).toBe(200);
  });

  it('gives the slot back when the response finishes', async () => {
    const gate = deferred();
    const { app, limit } = await buildApp(1, gate);

    const held = await startRequest(app, '/v1/slow');
    expect((await request(app).post('/v1/fast').send({})).status).toBe(503);

    gate.resolve();
    await held.response;
    expect(limit.inFlight()).toBe(0);
    expect((await request(app).post('/v1/fast').send({})).status).toBe(200);
  });

  it('gives the slot back when an admitted client disconnects before its handler finishes', async () => {
    const admitted = deferred();
    const disconnected = deferred();
    const gate = deferred();
    const limit = createInFlightLimit({ scope: 'test-disconnected-handler', max: 1 });
    const app = buildApplication({
      rateLimit: false,
      mountRoutes: (app) => {
        app.post('/v1/slow', limit, async (_req, res) => {
          res.once('close', disconnected.resolve);
          admitted.resolve();
          await gate.promise;
          res.json({ ok: true });
        });
        app.post('/v1/fast', limit, (_req, res) => res.json({ ok: true }));
      },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected an HTTP test port');
    const client = httpRequest({ host: '127.0.0.1', port: address.port, path: '/v1/slow', method: 'POST' });
    client.on('error', () => {});
    try {
      client.end();
      await admitted.promise;
      expect(limit.inFlight()).toBe(1);
      client.destroy();
      await disconnected.promise;
      expect(limit.inFlight()).toBe(0);
      expect((await request(server).post('/v1/fast').send({})).status).toBe(200);
    } finally {
      client.destroy();
      gate.resolve();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('counts sequential traffic against nothing', async () => {
    const gate = deferred();
    gate.resolve();
    const { app, limit } = await buildApp(1, gate);

    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/v1/fast').send({})).status).toBe(200);
    }
    expect(limit.inFlight()).toBe(0);
  });

  it('rejects a cap that is not a positive whole number', () => {
    expect(() => createInFlightLimit({ scope: 'bad', max: 0 })).toThrow(RangeError);
    expect(() => createInFlightLimit({ scope: 'bad', max: 1.5 })).toThrow(RangeError);
  });
});
