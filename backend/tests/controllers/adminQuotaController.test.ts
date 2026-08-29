import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { AccountQuotaUsage, Tier, User } from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

/**
 * The admin quota endpoints, which exist so that raising somebody's limit stops
 * being `UPDATE "User" SET monthly_quota_limit = ...` typed against production.
 *
 * Three things here are worth holding down, and each of them is the reason the
 * endpoint exists rather than an implementation detail:
 *
 * - The RESOLUTION ORDER. An override beats a tier beats the stored column, and
 *   getting it backwards means a support-granted limit silently reverts the next
 *   time anyone touches the account's tier.
 * - The CACHE INVALIDATION. The auth layer caches `User` rows, so a bump that
 *   does not clear them keeps billing the account against its old limit for
 *   exactly the window in which somebody is watching to see whether it worked.
 * - The AUDIT LINE, which is the whole point: it has to name the actor and both
 *   sides of the change, or it records no more than the SQL it replaced.
 */
setupTestSuite();

const invalidateUserCache = vi.fn();
const invalidateTierCache = vi.fn();
vi.mock('@app/middleware/authCacheStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/middleware/authCacheStore')>()),
  invalidateUserCache: (...a: unknown[]) => invalidateUserCache(...a),
}));
vi.mock('@app/middleware/apiLimiterQuota', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/middleware/apiLimiterQuota')>()),
  invalidateTierCache: (...a: unknown[]) => invalidateTierCache(...a),
}));

const logInfo = vi.fn();
vi.mock('@config/log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@config/log')>();
  return { ...actual, logger: { ...actual.logger, info: (...a: unknown[]) => logInfo(...a) } };
});

let app: Application;
let core: CoreFixtures;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

/** Creates a tier for this test, inside the rolled-back transaction. */
async function seedTier(id: string, overrides: Partial<Tier> = {}) {
  return Tier.save(
    Tier.create({
      id,
      displayName: id.toUpperCase(),
      monthlyQuotaLimit: 5000,
      rateLimitMax: null,
      rateLimitWindowMs: null,
      sortOrder: 1,
      ...overrides,
    } as Tier),
  );
}

/** Puts the fixture user on a known quota footing. */
async function resetTarget(patch: Partial<User> = {}) {
  const target = core.users.regular;
  await User.update(target.id, { tierId: null, quotaOverride: null, ...patch });
  return User.findOneByOrFail({ id: target.id });
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.kevin;
  invalidateUserCache.mockReset();
  invalidateTierCache.mockReset();
  logInfo.mockReset();
  await Tier.query('DELETE FROM "Tier"');
});

describe('GET /v1/admin/tiers', () => {
  it('lists the tiers', async () => {
    await seedTier('free', { monthlyQuotaLimit: 5000, sortOrder: 1 });
    await seedTier('pro', { monthlyQuotaLimit: 50_000, sortOrder: 2 });

    const res = await request(app).get('/v1/admin/tiers');

    expect(res.status).toBe(200);
    expect(res.body.tiers.map((t: { id: string }) => t.id)).toEqual(['free', 'pro']);
  });

  it('orders them by the sort column, not by id', async () => {
    // The list is rendered as a ladder, so the order is the meaning.
    await seedTier('zeta', { sortOrder: 1 });
    await seedTier('alpha', { sortOrder: 2 });

    const res = await request(app).get('/v1/admin/tiers');

    expect(res.body.tiers.map((t: { id: string }) => t.id)).toEqual(['zeta', 'alpha']);
  });

  it('carries the burst allowance, including the null that means "inherit"', async () => {
    // A tier that only changes the monthly number must not silently also change
    // the per-key burst.
    await seedTier('free', { rateLimitMax: null, rateLimitWindowMs: null });

    const res = await request(app).get('/v1/admin/tiers');

    expect(res.body.tiers[0]).toMatchObject({ rateLimitMax: null, rateLimitWindowMs: null });
  });

  it('returns an empty list rather than an error when no tiers exist', async () => {
    const res = await request(app).get('/v1/admin/tiers');

    expect(res.status).toBe(200);
    expect(res.body.tiers).toEqual([]);
  });
});

describe('GET /v1/admin/users/:userId/quota', () => {
  it('reports the account’s resolved limit and where it came from', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro' });

    const res = await request(app).get(`/v1/admin/users/${target.id}/quota`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: target.id,
      tierId: 'pro',
      monthlyQuotaLimit: 50_000,
      quotaSource: 'tier',
    });
  });

  it('an override wins over the tier, which is what makes it an escape hatch', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro', quotaOverride: 999_999 });

    const res = await request(app).get(`/v1/admin/users/${target.id}/quota`);

    expect(res.body).toMatchObject({ monthlyQuotaLimit: 999_999, quotaSource: 'override', tierId: 'pro' });
  });

  it('an account on no tier at all still resolves to a limit', async () => {
    // Every account predating the Tier table is in this state, and it has to
    // keep working rather than resolving to zero.
    const target = await resetTarget();

    const res = await request(app).get(`/v1/admin/users/${target.id}/quota`);

    expect(res.status).toBe(200);
    expect(res.body.tierId).toBeNull();
    expect(res.body.monthlyQuotaLimit).toBeGreaterThan(0);
  });

  it('cannot be left pointing at a tier that does not exist', async () => {
    // `resolveQuotaLimit` has a fallback for a dangling tier id, and this is
    // why it never fires from here: a foreign key makes the state unreachable.
    // Worth pinning, because dropping that constraint would turn a loud write
    // failure into an account silently running on a limit nobody chose.
    await expect(User.update(core.users.regular.id, { tierId: 'no-such-tier' })).rejects.toThrow(
      /foreign key constraint/i,
    );
  });

  it('reports how much of the period has been used', async () => {
    const target = await resetTarget();

    const res = await request(app).get(`/v1/admin/users/${target.id}/quota`);

    expect(res.body).toMatchObject({ quotaUsed: expect.any(Number), periodYyyymm: expect.any(Number) });
  });

  it('404s an account that does not exist', async () => {
    const res = await request(app).get('/v1/admin/users/99999999/quota');

    expect(res.status).toBe(404);
  });
});

describe('PATCH /v1/admin/users/:userId/quota', () => {
  it('moves the account onto a tier', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget();

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'pro' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tierId: 'pro', monthlyQuotaLimit: 50_000, quotaSource: 'tier' });
  });

  it('persists the move', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'pro' });

    expect((await User.findOneByOrFail({ id: target.id })).tierId).toBe('pro');
  });

  it('grants a one-off override', async () => {
    const target = await resetTarget();

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 250_000 });

    expect(res.body).toMatchObject({ quotaOverride: 250_000, monthlyQuotaLimit: 250_000, quotaSource: 'override' });
  });

  it('clears an override by setting it to null, returning the account to its tier', async () => {
    // Without this the escape hatch is one-way and the only way back is SQL --
    // which is the thing this endpoint exists to stop.
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro', quotaOverride: 999_999 });

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: null });

    expect(res.body).toMatchObject({ quotaOverride: null, monthlyQuotaLimit: 50_000, quotaSource: 'tier' });
  });

  it('leaves the tier alone when only the override is sent', async () => {
    // The body is a patch: an absent field means "unchanged", not "clear".
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro' });

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 1 });

    expect(res.body.tierId).toBe('pro');
  });

  it('leaves the override alone when only the tier is sent', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ quotaOverride: 777 });

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'pro' });

    expect(res.body.quotaOverride).toBe(777);
  });

  it('refuses an unknown tier with a 4xx rather than letting the driver 500', async () => {
    // A typo'd slug would otherwise surface as a foreign-key error from the
    // driver, and the account would keep whatever tier it had with nothing said.
    const target = await resetTarget();

    const res = await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'typo' });

    expect(res.status).toBe(400);
  });

  it('does not touch the account when the tier was refused', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro' });

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'typo', quotaOverride: 5 });

    const after = await User.findOneByOrFail({ id: target.id });
    expect(after).toMatchObject({ tierId: 'pro', quotaOverride: null });
  });

  it('404s an account that does not exist', async () => {
    const res = await request(app).patch('/v1/admin/users/99999999/quota').send({ quotaOverride: 1 });

    expect(res.status).toBe(404);
  });

  it('drops the cached user row, so the new limit applies to the next request', async () => {
    // The window this closes is exactly the one in which somebody is watching
    // to see whether the bump worked.
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 1 });

    expect(invalidateUserCache).toHaveBeenCalledWith(target.id);
    expect(invalidateTierCache).toHaveBeenCalled();
  });

  it('does not invalidate anything when the change was refused', async () => {
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'typo' });

    expect(invalidateUserCache).not.toHaveBeenCalled();
  });
});

describe('the audit line', () => {
  /** The `admin.quota.updated` line, which is the whole audit trail. */
  function auditLine() {
    return logInfo.mock.calls.map((c) => c[0]).find((p) => p?.event === 'admin.quota.updated');
  }

  it('names the actor and the target with real ids', async () => {
    // An audit entry that cannot name who did it is not one.
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 250_000 });

    expect(auditLine()).toMatchObject({ 'actor.id': core.users.kevin.id, 'target.id': target.id });
  });

  it('records both sides of the change, not only what it was set to', async () => {
    await seedTier('pro', { monthlyQuotaLimit: 50_000 });
    const target = await resetTarget({ tierId: 'pro' });

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 250_000 });

    expect(auditLine()).toMatchObject({
      'quota.before': { tierId: 'pro', override: null, limit: 50_000 },
      'quota.after': { tierId: 'pro', override: 250_000, limit: 250_000 },
    });
  });

  it('keeps the reason the change was made', async () => {
    const target = await resetTarget();

    await request(app)
      .patch(`/v1/admin/users/${target.id}/quota`)
      .send({ quotaOverride: 250_000, reason: 'support ticket 412' });

    expect(auditLine()?.reason).toBe('support ticket 412');
  });

  it('records a null reason rather than omitting the field', async () => {
    // A missing key and an unexplained change look the same in a log query;
    // an explicit null does not.
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ quotaOverride: 1 });

    expect(auditLine()).toHaveProperty('reason', null);
  });

  it('writes nothing when the change was refused', async () => {
    const target = await resetTarget();

    await request(app).patch(`/v1/admin/users/${target.id}/quota`).send({ tierId: 'typo' });

    expect(auditLine()).toBeUndefined();
  });
});

describe('quota usage', () => {
  it('is reported against the account’s current limit', async () => {
    const target = await resetTarget({ quotaOverride: 12_345 });

    const res = await request(app).get(`/v1/admin/users/${target.id}/quota`);
    const usage = await AccountQuotaUsage.getForUser(target.id, 12_345);

    expect(res.body.quotaUsed).toBe(usage.quotaUsed);
    expect(res.body.periodYyyymm).toBe(usage.periodYyyymm);
  });
});
