import { describe, it, expect, beforeAll, vi } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { rateLimitApiQuota, invalidateTierCache } from '@app/middleware/apiLimiterQuota';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { QuotaExceededError } from '@app/errors';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { Tier } from '@app/models';

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
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    on: vi.fn((event: string, cb: (...args: never) => unknown) => {
      listeners[event] = cb;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    _listeners: listeners,
    _headers: headers,
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
    // An override of 0 so any usage exceeds it. This used to set
    // `monthlyQuotaLimit`, which no longer decides anything for an account on a
    // tier -- the tier wins, and the column is only the fallback for one that
    // has none.
    fixtures.users.kevin.quotaOverride = 0;

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await expect(rateLimitApiQuota(req, res, next)).rejects.toThrow(QuotaExceededError);
    expect(next).not.toHaveBeenCalled();

    // Restore
    fixtures.users.kevin.quotaOverride = null;
  });

  it('names the monthly quota as the reason on the error it throws', async () => {
    // The reason rides on the error rather than on the response, because the
    // other caller that raises a 429 (the API-key path in authentication.ts)
    // has no response to set a header on. The error handler is what turns this
    // into `X-RateLimit-Reason`.
    fixtures.users.kevin.quotaOverride = 0;

    const req = buildReq();
    const res = buildRes();

    await expect(rateLimitApiQuota(req, res, vi.fn())).rejects.toMatchObject({ reason: 'monthly_quota' });

    fixtures.users.kevin.quotaOverride = null;
  });

  it('announces the month on every authenticated response, not only the rejection', async () => {
    // The account page renders its bar from these. Sending them on success is
    // what saves it a second round trip to ask what the call it just made
    // already knew.
    const req = buildReq();
    const res = buildRes();

    await rateLimitApiQuota(req, res, vi.fn());

    expect(res._headers['X-Monthly-Quota-Limit']).toBe(String(req.accountQuota.quotaLimit));
    expect(res._headers['X-Monthly-Quota-Used']).toBe(String(req.accountQuota.quotaUsed));
    // An ISO instant, so a client can render "resets on ..." in its own locale
    // rather than parsing a period integer it has no calendar for.
    expect(res._headers['X-Monthly-Quota-Reset']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('bills against the tier when the account has no override', async () => {
    // The point of the whole change: the limit comes from a row the account
    // points at, not from a number typed onto the account.
    const user = fixtures.users.kevin;
    const previous = { tierId: user.tierId, override: user.quotaOverride, column: user.monthlyQuotaLimit };

    await Tier.upsert({ id: 'test-plus', displayName: 'Test Plus', monthlyQuotaLimit: 31_337, sortOrder: 99 }, ['id']);
    invalidateTierCache();
    user.tierId = 'test-plus';
    user.quotaOverride = null;
    user.monthlyQuotaLimit = 5000;

    const req = buildReq();
    await rateLimitApiQuota(req, buildRes(), vi.fn());
    expect(req.accountQuota.quotaLimit).toBe(31_337);

    // An override is the escape hatch, and it wins.
    user.quotaOverride = 42;
    const overridden = buildReq();
    await rateLimitApiQuota(overridden, buildRes(), vi.fn());
    expect(overridden.accountQuota.quotaLimit).toBe(42);

    user.tierId = previous.tierId;
    user.quotaOverride = previous.override;
    user.monthlyQuotaLimit = previous.column;
    invalidateTierCache();
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
