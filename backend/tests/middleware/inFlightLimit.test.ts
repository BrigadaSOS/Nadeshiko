import { describe, it, expect } from 'vitest';
import type { Application, Request, Response } from 'express';
import type { Response as SupertestResponse } from 'supertest';
import { request } from '../helpers/http';
import { createInFlightLimit } from '@app/middleware/inFlightLimit';
import { buildApplication } from '@config/application';

/**
 * The in-flight cap, driven through a real Express app so the 503 goes out
 * through the production error handler and carries the envelope a client would
 * actually see.
 *
 * Each test holds slots open with a handler that waits on a promise the test
 * resolves, because the property being checked is about requests that are
 * still running -- a limiter that only ever saw sequential requests could pass
 * every assertion here while doing nothing at all under load.
 */
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
  // One awaited request before any is held open: the helper binds the app's
  // server on first use, and a request fired-and-forgotten against a server
  // that is not yet listening never reaches the limiter at all -- which made
  // the first draft of this file believe two requests were in flight while the
  // count sat at zero.
  expect((await request(app).post('/v1/warm').send({})).status).toBe(200);
  return { app, limit };
}

/** A request that has left the client and is being served right now. */
type Held = { response: Promise<SupertestResponse> };

/**
 * Sends a request NOW and gives the server a tick to accept it before the next.
 *
 * Two things here are deliberate and both were got wrong once. `.end()` rather
 * than the thenable: a supertest request does not leave the client until
 * something asks for its result, so awaiting it later would mean nothing was in
 * flight while the test believed two requests were. And the promise comes back
 * INSIDE an object: returning it bare from an async function adopts it, so
 * `await startRequest()` would wait for the held request to finish -- which it
 * cannot until the test releases it.
 */
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
