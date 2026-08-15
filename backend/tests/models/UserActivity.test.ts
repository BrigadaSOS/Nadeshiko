import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { UserActivity, ActivityType } from '@app/models/UserActivity';

setupTestSuite();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

const reader = () => fixtures.users.regular;

const searches = async () =>
  UserActivity.find({
    where: { userId: reader().id, activityType: ActivityType.SEARCH },
    order: { id: 'ASC' },
  });

const track = (data: { searchQuery?: string; mediaPublicId?: string | null }) =>
  UserActivity.trackForUser(reader(), ActivityType.SEARCH, data as never);

beforeEach(async () => {
  await UserActivity.delete({ userId: reader().id });
});

/**
 * The per-day collapse of repeated searches. These hit the database on purpose:
 * the whole behaviour lives in an UPDATE's WHERE clause and in the difference
 * between two SQL time functions, and nothing above the driver type-checks
 * either.
 *
 * It has already regressed once in the obvious way. The first version bumped
 * with `CURRENT_TIMESTAMP`, which is the TRANSACTION's start time: the update
 * wrote back the value it had just read, `affected` came back 1, and the code
 * looked correct while the row never moved. A test asserting only "one row"
 * passes against that bug -- so the assertion that matters here is that
 * `createdAt` is strictly later afterwards.
 */
describe('trackForUser: SEARCH', () => {
  it('keeps one row for the same search repeated in a day, and moves it to now', async () => {
    await track({ searchQuery: 'ねこ' });
    const [first] = await searches();
    expect(first).toBeDefined();

    // `clock_timestamp()` is wall clock, but two statements in the same
    // millisecond would still compare equal, so give it something to move past.
    await new Promise((resolve) => setTimeout(resolve, 25));

    await track({ searchQuery: 'ねこ' });
    await track({ searchQuery: 'ねこ' });

    const rows = await searches();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first!.id);
    expect(new Date(rows[0]!.createdAt).getTime()).toBeGreaterThan(new Date(first!.createdAt).getTime());
  });

  it('gives a different query its own row', async () => {
    await track({ searchQuery: 'ねこ' });
    await track({ searchQuery: 'いぬ' });

    expect(await searches()).toHaveLength(2);
  });

  it('treats a search inside a title as a different search from the same one across everything', async () => {
    // `NULL = NULL` is not true in SQL, so the unscoped row can only be found by
    // an `IS NULL` -- compare with `=` and every unscoped repeat inserts afresh.
    await track({ searchQuery: 'ねこ' });
    await track({ searchQuery: 'ねこ', mediaPublicId: 'V1StGXR8_Z5d' });

    const rows = await searches();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.mediaPublicId)).toEqual([null, 'V1StGXR8_Z5d']);

    // And each of the two collapses on its own.
    await track({ searchQuery: 'ねこ' });
    await track({ searchQuery: 'ねこ', mediaPublicId: 'V1StGXR8_Z5d' });
    expect(await searches()).toHaveLength(2);
  });

  it('leaves a row from a previous day alone, so the heatmap keeps its square', async () => {
    // The reason the collapse is scoped to the day at all: `getHeatmapForUser`
    // counts rows per `DATE(created_at)`, so folding yesterday's row into
    // today's would take a square off the calendar rather than add one.
    await track({ searchQuery: 'ねこ' });
    const [yesterday] = await searches();
    await UserActivity.createQueryBuilder()
      .update(UserActivity)
      .set({ createdAt: () => "clock_timestamp() - interval '1 day'" })
      .where('id = :id', { id: yesterday!.id })
      .execute();

    await track({ searchQuery: 'ねこ' });

    const rows = await searches();
    expect(rows).toHaveLength(2);
  });

  it('records nothing at all when the reader turned search history off', async () => {
    const off = { ...reader(), preferences: { searchHistory: { enabled: false } } };
    await UserActivity.trackForUser(off as never, ActivityType.SEARCH, { searchQuery: 'ねこ' } as never);

    expect(await searches()).toHaveLength(0);
  });
});
