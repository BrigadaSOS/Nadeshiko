import 'dotenv/config';
import { describe, it, expect, beforeAll, vi } from 'bun:test';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { QuotaExceededError } from '@app/errors';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

function buildReq(overrides: Record<string, unknown> = {}) {
  return {
    user: fixtures.users.kevin,
    auth: {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.USER, permissions: [ApiPermission.READ_MEDIA] },
    },
    ...overrides,
  } as any;
}

function buildRes() {
  const listeners: Record<string, (...args: never) => unknown> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: (...args: never) => unknown) => {
      listeners[event] = cb;
    }),
    _listeners: listeners,
  } as any;
}

describe('rateLimitApiQuota', () => {
  it('skips quota check for session auth', async () => {
    const req = buildReq({ auth: { type: AuthType.SESSION } });
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.accountQuota).toBeUndefined();
  });

  it('skips quota check for service API keys', async () => {
    const req = buildReq({
      auth: {
        type: AuthType.API_KEY,
        apiKey: { kind: ApiKeyKind.SERVICE, permissions: [ApiPermission.READ_MEDIA] },
      },
    });
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.accountQuota).toBeUndefined();
  });

  it('passes and attaches quota snapshot when under limit', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(typeof req.accountQuota.quotaLimit).toBe('number');
    expect(typeof req.accountQuota.quotaUsed).toBe('number');
    expect(req.accountQuota.quotaUsed).toBeLessThan(req.accountQuota.quotaLimit);
  });

  it('throws QuotaExceededError when quota is exhausted', async () => {
    // Set the user's monthly quota limit to 0 so any usage exceeds it
    fixtures.users.kevin.monthlyQuotaLimit = 0;

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await expect(rateLimitApiQuota(req, res, next)).rejects.toThrow(QuotaExceededError);
    expect(next).not.toHaveBeenCalled();

    // Restore
    fixtures.users.kevin.monthlyQuotaLimit = 2500;
  });

  it('throws when req.user is missing', async () => {
    const req = buildReq({ user: undefined });
    const res = buildRes();
    const next = vi.fn();

    await expect(rateLimitApiQuota(req, res, next)).rejects.toThrow('Invalid API key owner');
  });

  it('registers a finish listener to increment quota on success', async () => {
    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('increments quota on successful 2xx response', async () => {
    const spy = vi.spyOn(AccountQuotaUsage, 'incrementForUser').mockResolvedValue(undefined as any);

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    res.statusCode = 200;
    res._listeners['finish']();

    expect(spy).toHaveBeenCalledWith(fixtures.users.kevin.id);

    spy.mockRestore();
  });

  it('does not increment quota on non-2xx response', async () => {
    const spy = vi.spyOn(AccountQuotaUsage, 'incrementForUser').mockResolvedValue(undefined as any);

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await rateLimitApiQuota(req, res, next);

    res.statusCode = 404;
    res._listeners['finish']();

    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
