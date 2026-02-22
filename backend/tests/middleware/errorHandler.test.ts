import 'dotenv/config';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction, type ErrorRequestHandler } from 'express';
import { describe, it, expect } from 'bun:test';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { ExpressRuntimeError, RequestInputType } from '@nahkies/typescript-express-runtime/errors';
import { handleErrors } from '@app/middleware/errorHandler';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { NotFoundError } from '@app/errors';

/**
 * Builds a mini Express app where GET /test throws the given error.
 * Uses a plain app.get() route so req.route.path is set (needed for
 * the routeErrorCodes validation in handleErrors).
 */
function createErrorApp(thrower: (req: Request) => void) {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/test', (req: Request, _res: Response) => {
    thrower(req);
  });
  app.use(handleErrors as ErrorRequestHandler);
  return app;
}

// ---------------------------------------------------------------------------
// ApiError subclasses
// ---------------------------------------------------------------------------

describe('handleErrors', () => {
  describe('ApiError', () => {
    it('returns the status and code from an ApiError', async () => {
      const app = createErrorApp(() => {
        throw new NotFoundError('Thing not found');
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', detail: 'Thing not found' });
    });

    it('attaches requestId as instance', async () => {
      const app = createErrorApp(() => {
        throw new NotFoundError();
      });

      const res = await request(app).get('/test');

      expect(res.body.instance).toMatch(/^nade-/);
    });

    it('preserves an existing instance on the error', async () => {
      const app = createErrorApp(() => {
        const err = new NotFoundError();
        err.instance = 'custom-instance';
        throw err;
      });

      const res = await request(app).get('/test');

      expect(res.body.instance).toBe('custom-instance');
    });
  });

  // ---------------------------------------------------------------------------
  // QueryFailedError — PostgreSQL duplicate key (23505)
  // ---------------------------------------------------------------------------

  describe('QueryFailedError — unique violation (23505)', () => {
    it('returns 409 DUPLICATE_KEY', async () => {
      const app = createErrorApp(() => {
        const driverError: any = new Error('duplicate key');
        driverError.code = '23505';
        driverError.table = 'media';
        throw new QueryFailedError('INSERT INTO media ...', [], driverError);
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_KEY' });
    });

    it('derives resource name from table', async () => {
      const app = createErrorApp(() => {
        const driverError: any = new Error('duplicate key');
        driverError.code = '23505';
        driverError.table = 'media_external_id';
        throw new QueryFailedError('INSERT ...', [], driverError);
      });

      const res = await request(app).get('/test');

      expect(res.body.detail).toContain('Media External Id');
    });
  });

  // ---------------------------------------------------------------------------
  // QueryFailedError — foreign key violation (23503)
  // ---------------------------------------------------------------------------

  describe('QueryFailedError — foreign key violation (23503)', () => {
    it('returns 404 NOT_FOUND', async () => {
      const app = createErrorApp(() => {
        const driverError: any = new Error('violates foreign key constraint');
        driverError.code = '23503';
        driverError.constraint = 'FK_media_series_id_fkey';
        throw new QueryFailedError('INSERT ...', [], driverError);
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ---------------------------------------------------------------------------
  // QueryFailedError — unknown code
  // ---------------------------------------------------------------------------

  describe('QueryFailedError — unknown code', () => {
    it('returns 500 for unrecognized PostgreSQL error codes', async () => {
      const app = createErrorApp(() => {
        const driverError: any = new Error('something weird');
        driverError.code = '42P01'; // undefined_table
        throw new QueryFailedError('SELECT ...', [], driverError);
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_SERVER_EXCEPTION' });
    });
  });

  // ---------------------------------------------------------------------------
  // EntityNotFoundError
  // ---------------------------------------------------------------------------

  describe('EntityNotFoundError', () => {
    it('returns 404 with parsed entity name', async () => {
      const app = createErrorApp(() => {
        throw new EntityNotFoundError('User', { id: 1 });
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', detail: 'User not found' });
    });

    it('returns generic detail for unknown entity types', async () => {
      const app = createErrorApp(() => {
        throw new EntityNotFoundError('Widget', { id: 1 });
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body.detail).toContain('Widget not found');
    });
  });

  // ---------------------------------------------------------------------------
  // ExpressRuntimeError
  // ---------------------------------------------------------------------------

  describe('ExpressRuntimeError', () => {
    it('returns 400 with field errors for request_validation phase', async () => {
      const app = createErrorApp(() => {
        const zodError = { issues: [{ path: ['body', 'name'], message: 'Required' }] };
        throw ExpressRuntimeError.RequestError(zodError, RequestInputType.RequestBody);
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: { 'body.name': 'Required' },
      });
    });

    it('unwraps an ApiError from request_handler phase', async () => {
      const app = createErrorApp(() => {
        throw ExpressRuntimeError.HandlerError(new NotFoundError('Gone'));
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND', detail: 'Gone' });
    });

    it('returns 500 for response_validation phase', async () => {
      const app = createErrorApp(() => {
        throw ExpressRuntimeError.ResponseError(new Error('bad response'));
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_SERVER_EXCEPTION' });
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown errors
  // ---------------------------------------------------------------------------

  describe('unknown errors', () => {
    it('returns 500 INTERNAL_SERVER_EXCEPTION', async () => {
      const app = createErrorApp(() => {
        throw new Error('something completely unexpected');
      });

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL_SERVER_EXCEPTION' });
    });
  });

  // ---------------------------------------------------------------------------
  // Headers already sent
  // ---------------------------------------------------------------------------

  describe('headers already sent', () => {
    it('delegates to next() without crashing', async () => {
      const app = express();
      app.use(requestIdMiddleware);
      app.get('/test', (_req: Request, res: Response, next: NextFunction) => {
        res.status(200).json({ ok: true });
        // Simulate an error after headers have been sent
        next(new Error('late error'));
      });
      app.use(handleErrors as ErrorRequestHandler);

      const res = await request(app).get('/test');

      // The original 200 response should be returned
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true });
    });
  });
});
