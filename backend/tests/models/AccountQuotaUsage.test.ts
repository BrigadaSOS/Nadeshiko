import { describe, it, expect, beforeAll } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

/**
 * These hit the database on purpose. `incrementForUser` is a single
 * `INSERT ... ON CONFLICT DO UPDATE` whose whole job is the `+ 1` in the update
 * branch, and that arithmetic lives inside a SQL string -- nothing type-checks
 * it, and the other quota tests mock the method out entirely (see
 * `tests/middleware/apiLimiterQuota.test.ts`), so before this file the statement
 * was never executed by the suite at all.
 *
 * It earned coverage during the TypeORM v1 upgrade. v1 removed `onConflict()`,
 * and the obvious replacement -- `orUpdate(['requestCount'])` -- overwrites the
 * conflicting row with the values from the INSERT, which would have pinned the
 * count at 1 on every collision instead of adding to it. A counter quietly
 * degrading into a flag passes every type check and throws nothing at runtime.
 * Only asserting that the second call reads 2 catches it.
 *
 * Not covered here: concurrency. Each test runs inside one transaction on one
 * connection, so parallel calls would serialise and prove nothing about the
 * races the single-statement form actually exists to survive.
 */
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
