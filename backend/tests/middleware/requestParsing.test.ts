import request from 'supertest';
import express, { type Request, type Response, type ErrorRequestHandler } from 'express';
import { describe, it, expect } from 'bun:test';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { handleJsonParseErrors } from '@app/middleware/requestParsing';

function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(handleJsonParseErrors as ErrorRequestHandler);

  app.post('/test', (req: Request, res: Response) => {
    res.status(200).json({ received: req.body });
  });

  return app;
}

describe('handleJsonParseErrors', () => {
  const app = createApp();

  it('returns 400 INVALID_JSON for malformed JSON body', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ not valid json }');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'INVALID_JSON',
      status: 400,
    });
  });

  it('includes requestId as instance on the error', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send('{ bad }');

    expect(res.body.instance).toMatch(/^nade-/);
  });

  it('passes valid JSON through to the handler', async () => {
    const res = await request(app)
      .post('/test')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'test' }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: { name: 'test' } });
  });

  it('passes requests without a body through', async () => {
    const getApp = express();
    getApp.use(requestIdMiddleware);
    getApp.use(express.json());
    getApp.use(handleJsonParseErrors as ErrorRequestHandler);
    getApp.get('/test', (_req: Request, res: Response) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(getApp).get('/test');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });
});
