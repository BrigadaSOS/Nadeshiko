import { beforeAll, beforeEach, afterAll, describe, expect, it, vi, type Mock } from 'bun:test';
import type { NextFunction, Request, Response } from 'express';
import { auth } from '@config/auth';
import { invalidateAuthCachesAfterMutation } from '@app/middleware/authCacheInvalidation';
import * as authCacheStore from '@app/middleware/authCacheStore';

let mockGetSession: Mock<any>;
let invalidateUserCacheSpy: Mock<any>;
let invalidateApiKeyCacheSpy: Mock<any>;

beforeAll(() => {
  mockGetSession = vi.spyOn(auth.api, 'getSession') as any;
  invalidateUserCacheSpy = vi.spyOn(authCacheStore, 'invalidateUserCache') as any;
  invalidateApiKeyCacheSpy = vi.spyOn(authCacheStore, 'invalidateApiKeyCacheForUser') as any;
});

afterAll(() => {
  mockGetSession.mockRestore();
  invalidateUserCacheSpy.mockRestore();
  invalidateApiKeyCacheSpy.mockRestore();
});

beforeEach(() => {
  mockGetSession.mockReset();
  invalidateUserCacheSpy.mockClear();
  invalidateApiKeyCacheSpy.mockClear();
});

describe('invalidateAuthCachesAfterMutation', () => {
  it('invalidates caches after successful API key mutation', async () => {
    mockGetSession.mockResolvedValue({ user: { id: '42' } });

    const req = createRequest({
      method: 'POST',
      path: '/v1/auth/api-key/update',
      originalUrl: '/v1/auth/api-key/update',
      headers: {},
    });
    const { res, emitFinish } = createResponse(200);
    const next = vi.fn() as unknown as NextFunction;

    await invalidateAuthCachesAfterMutation(req, res, next);
    emitFinish();

    expect(next).toHaveBeenCalledTimes(1);
    expect(invalidateUserCacheSpy).toHaveBeenCalledWith(42);
    expect(invalidateApiKeyCacheSpy).toHaveBeenCalledWith(42);
  });

  it('does not track non-mutation auth routes', async () => {
    const req = createRequest({
      method: 'GET',
      path: '/v1/auth/get-session',
      originalUrl: '/v1/auth/get-session',
      headers: {},
    });
    const { res } = createResponse(200);
    const next = vi.fn() as unknown as NextFunction;

    await invalidateAuthCachesAfterMutation(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(invalidateUserCacheSpy).not.toHaveBeenCalled();
    expect(invalidateApiKeyCacheSpy).not.toHaveBeenCalled();
  });

  it('does not invalidate caches for failed mutation responses', async () => {
    mockGetSession.mockResolvedValue({ user: { id: '7' } });

    const req = createRequest({
      method: 'POST',
      path: '/v1/auth/api-key/delete',
      originalUrl: '/v1/auth/api-key/delete',
      headers: {},
    });
    const { res, emitFinish } = createResponse(401);
    const next = vi.fn() as unknown as NextFunction;

    await invalidateAuthCachesAfterMutation(req, res, next);
    emitFinish();

    expect(next).toHaveBeenCalledTimes(1);
    expect(invalidateUserCacheSpy).not.toHaveBeenCalled();
    expect(invalidateApiKeyCacheSpy).not.toHaveBeenCalled();
  });

  it('does not invalidate when no session user is available', async () => {
    mockGetSession.mockResolvedValue(null);

    const req = createRequest({
      method: 'POST',
      path: '/v1/auth/revoke-sessions',
      originalUrl: '/v1/auth/revoke-sessions',
      headers: {},
    });
    const { res, emitFinish } = createResponse(200);
    const next = vi.fn() as unknown as NextFunction;

    await invalidateAuthCachesAfterMutation(req, res, next);
    emitFinish();

    expect(next).toHaveBeenCalledTimes(1);
    expect(invalidateUserCacheSpy).not.toHaveBeenCalled();
    expect(invalidateApiKeyCacheSpy).not.toHaveBeenCalled();
  });
});

function createRequest(overrides: Partial<Request>): Request {
  return {
    method: 'POST',
    path: '/v1/auth/api-key/update',
    originalUrl: '/v1/auth/api-key/update',
    headers: {},
    ...overrides,
  } as Request;
}

function createResponse(statusCode: number): { res: Response; emitFinish: () => void } {
  let finishHandler: (() => void) | null = null;
  const res = {
    statusCode,
    on(event: string, handler: () => void) {
      if (event === 'finish') {
        finishHandler = handler;
      }
      return this;
    },
  } as unknown as Response;

  return {
    res,
    emitFinish: () => finishHandler?.(),
  };
}
