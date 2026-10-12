import express, { type ErrorRequestHandler, type Request } from 'express';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { QueryFailedError, TypeORMError } from 'typeorm';
import { ExpressRuntimeError } from '@nahkies/typescript-express-runtime/errors';
import { InternalServerError } from '@app/errors';
import { request } from '../helpers/http';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  const span = {
    setAttribute: vi.fn((_name: string, _value: string) => events.push('span.setAttribute')),
  };

  return {
    events,
    span,
    recordError: vi.fn((_error: Error, _errorType: string, _attrs: Record<string, string>) => {
      events.push('recordError');
      return { fingerprint: 'fingerprint', group: 'group' };
    }),
    recordClientError: vi.fn(),
    trafficAttributesFor: vi.fn(() => {
      events.push('trafficAttributesFor');
      return { traffic: 'bot', 'bot.family': 'gptbot' };
    }),
    error: vi.fn((_payload: unknown, _message: string) => events.push('logger.error')),
    warn: vi.fn((_payload: unknown, _message: string) => events.push('logger.warn')),
  };
});

vi.mock('@lib/errorFingerprint', () => ({
  recordError: mocks.recordError,
  recordClientError: mocks.recordClientError,
}));
vi.mock('@app/middleware/trafficClassification', () => ({ trafficAttributesFor: mocks.trafficAttributesFor }));
vi.mock('@config/log', () => ({ logger: { error: mocks.error, warn: mocks.warn } }));
vi.mock('@opentelemetry/api', () => ({ trace: { getActiveSpan: () => mocks.span } }));

const { handleErrors } = await import('@app/middleware/errorHandler');

function appFor(error: Error) {
  const app = express();
  app.use((req: Request, _res, next) => {
    req.requestId = 'request-123';
    req.user = { id: 42 } as Request['user'];
    next();
  });
  app.get('/v1/error', () => {
    throw error;
  });
  app.use(handleErrors as ErrorRequestHandler);
  return app;
}

function unknownQueryError() {
  const driverError: any = new Error('missing table');
  driverError.code = '42P01';
  return new QueryFailedError('SELECT ...', [], driverError);
}

function loggedPayload() {
  const call = [...mocks.error.mock.calls, ...mocks.warn.mock.calls][0];
  return { payload: call?.[0] as Record<string, unknown>, message: call?.[1] as string };
}

beforeEach(() => {
  mocks.events.length = 0;
  vi.clearAllMocks();
});

describe('error-handler logging boundary', () => {
  it.each([
    ['unknown error', () => new Error('unexpected'), 'error', 'Unhandled error', 'Error'],
    ['query failure', unknownQueryError, 'warn', 'Database query failed', 'QueryFailedError'],
    ['direct server ApiError', () => new InternalServerError(), 'error', 'Server error', 'InternalServerError'],
    [
      'handler query failure',
      () => ExpressRuntimeError.HandlerError(unknownQueryError()),
      'warn',
      'Database query failed in handler',
      'QueryFailedError',
    ],
    [
      'handler TypeORM failure',
      () => ExpressRuntimeError.HandlerError(new TypeORMError('orm failure')),
      'warn',
      'TypeORM error in handler',
      'TypeORMError',
    ],
    [
      'handler unknown failure',
      () => ExpressRuntimeError.HandlerError(new Error('handler failure')),
      'error',
      'Unhandled error in handler',
      'Error',
    ],
    [
      'response validation failure',
      () => ExpressRuntimeError.ResponseError(new Error('bad response')),
      'error',
      'Response validation failed',
      'Error',
    ],
  ])('preserves the %s log and instrumentation contract', async (_case, makeError, severity, message, errorType) => {
    const error = makeError();
    const res = await request(appFor(error)).get('/v1/error');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: 'INTERNAL_SERVER_EXCEPTION',
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred. Please try again later.',
      type: 'https://github.com/BrigadaSOS/Nadeshiko/issues/new?template=bug_report.yml',
      status: 500,
      instance: 'request-123',
    });

    const logged = loggedPayload();
    expect(logged.message).toBe(message);
    expect(Object.keys(logged.payload)).toEqual([
      'err',
      'requestId',
      'traffic',
      'bot.family',
      'error.fingerprint',
      'error.group',
    ]);
    expect(logged.payload).toEqual({
      err: expect.any(Error),
      requestId: 'request-123',
      traffic: 'bot',
      'bot.family': 'gptbot',
      'error.fingerprint': 'fingerprint',
      'error.group': 'group',
    });
    expect(logged.payload.err).toBe(error instanceof ExpressRuntimeError ? error.cause : error);

    expect(mocks.recordError).toHaveBeenCalledWith(
      error instanceof ExpressRuntimeError ? error.cause : error,
      errorType,
      { 'http.route': '/v1/error', traffic: 'bot', 'bot.family': 'gptbot' },
    );
    expect(severity === 'error' ? mocks.error.mock.calls : mocks.warn.mock.calls).toHaveLength(1);
    expect(mocks.span.setAttribute).toHaveBeenCalledWith('enduser.id', '42');
    expect(mocks.events).toEqual([
      'trafficAttributesFor',
      'recordError',
      'span.setAttribute',
      'trafficAttributesFor',
      `logger.${severity}`,
    ]);
  });

  it('keeps a wrapped server ApiError metric-only, without adding a logger call', async () => {
    const cause = new InternalServerError();
    const wrapped = ExpressRuntimeError.HandlerError(cause);
    const res = await request(appFor(wrapped)).get('/v1/error');

    expect(res.status).toBe(500);
    expect(res.body.instance).toBe('request-123');
    expect(mocks.recordError).toHaveBeenCalledWith(cause, 'InternalServerError', {
      'http.route': '/v1/error',
      traffic: 'bot',
      'bot.family': 'gptbot',
    });
    expect(mocks.error.mock.calls).toEqual([]);
    expect(mocks.warn.mock.calls).toEqual([]);
    expect(mocks.events).toEqual(['trafficAttributesFor', 'recordError', 'span.setAttribute']);
  });
});
