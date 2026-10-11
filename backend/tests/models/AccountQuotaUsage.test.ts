import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

/** Exercise the real SQL upsert: `orUpdate` can overwrite the conflicting row and pin the count at 1. The second
 * call must read 2; concurrency is intentionally outside this one-connection suite. */
describe('AccountQuotaUsage.incrementForUser', () => {
  const currentPeriod = () => AccountQuotaUsage.getCurrentPeriodYyyymm();

  const countFor = async (userId: number): Promise<number> => {
    const usage = await AccountQuotaUsage.findOneOrFail({
      where: { userId, periodYyyymm: currentPeriod() },
    });
    return usage.requestCount;
  };

  it('creates the row on first use', async () => {
    const userId = fixtures.users.kevin.id;

    await AccountQuotaUsage.incrementForUser(userId);

    expect(await countFor(userId)).toBe(1);
  });

  it('adds to the existing count instead of resetting it', async () => {
    const userId = fixtures.users.david.id;

    await AccountQuotaUsage.incrementForUser(userId);
    await AccountQuotaUsage.incrementForUser(userId);
    await AccountQuotaUsage.incrementForUser(userId);

    expect(await countFor(userId)).toBe(3);
  });

  it('counts each user separately', async () => {
    const kevin = fixtures.users.kevin.id;
    const regular = fixtures.users.regular.id;

    await AccountQuotaUsage.incrementForUser(kevin);
    await AccountQuotaUsage.incrementForUser(kevin);
    await AccountQuotaUsage.incrementForUser(regular);

    expect(await countFor(kevin)).toBe(2);
    expect(await countFor(regular)).toBe(1);
  });

  it('starts a fresh count in a new period', async () => {
    const userId = fixtures.users.david.id;

    await AccountQuotaUsage.incrementForUser(userId);
    // The unique index is (user_id, period_yyyymm), so a different month is a
    // different row rather than a conflict -- this is what makes the quota
    // monthly rather than lifetime.
    await AccountQuotaUsage.getRepository().insert({
      userId,
      periodYyyymm: currentPeriod() - 1,
      requestCount: 99,
    });

    expect(await countFor(userId)).toBe(1);
  });
});
