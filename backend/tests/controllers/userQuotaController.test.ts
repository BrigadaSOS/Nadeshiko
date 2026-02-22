import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/user/quota', () => {
  it('returns zero usage when user has no quota record', async () => {
    const res = await request(app).get('/v1/user/quota');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      quotaUsed: 0,
      quotaLimit: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT,
      quotaRemaining: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT,
    });
  });

  it('returns correct usage when quota record exists', async () => {
    const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
    await AccountQuotaUsage.save({
      userId: fixtures.users.kevin.id,
      periodYyyymm,
      requestCount: 42,
    });

    const res = await request(app).get('/v1/user/quota');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      quotaUsed: 42,
      quotaLimit: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT,
      quotaRemaining: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT - 42,
    });
  });

  it('clamps quotaRemaining to 0 when over limit', async () => {
    const periodYyyymm = AccountQuotaUsage.getCurrentPeriodYyyymm();
    await AccountQuotaUsage.save({
      userId: fixtures.users.kevin.id,
      periodYyyymm,
      requestCount: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT + 100,
    });

    const res = await request(app).get('/v1/user/quota');

    expect(res.status).toBe(200);
    expect(res.body.quotaRemaining).toBe(0);
  });

  it('uses custom quota limit from user record', async () => {
    await fixtures.users.kevin.save();
    signInAs(app, { ...fixtures.users.kevin, monthlyQuotaLimit: 9999 } as typeof fixtures.users.kevin);

    const res = await request(app).get('/v1/user/quota');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      quotaLimit: 9999,
      quotaRemaining: 9999,
    });
  });

  it('returns period window dates in ISO format', async () => {
    const res = await request(app).get('/v1/user/quota');

    expect(res.status).toBe(200);
    expect(res.body.periodYyyymm).toBeTypeOf('number');
    expect(res.body.periodStart).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(res.body.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/);
  });
});
