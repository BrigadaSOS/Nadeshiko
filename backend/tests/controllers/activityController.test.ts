import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { UserActivity } from '@app/models/UserActivity';
import { assertDifference, assertNoDifference } from '../helpers/assertions';

setupTestSuite();

const app = createTestApp();
let core: CoreFixtures;
let fixtures: LoadedFixtures;

beforeAll(async () => {
  core = await seedCoreFixtures();
});
beforeEach(async () => {
  fixtures = await loadFixtures(['kevinActivities', 'davidActivity'], { users: core.users });
  signInAs(app, core.users.kevin);
});

describe('GET /v1/user/activity', () => {
  it('returns keyset-paginated activity and excludes other users', async () => {
    const page1 = await request(app).get('/v1/user/activity?take=3');
    expect(page1.status).toBe(200);
    expect(page1.body.activities).toHaveLength(3);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.activities.every((a: { searchQuery?: string }) => a.searchQuery !== 'other-user')).toBe(true);

    const page2 = await request(app).get(`/v1/user/activity?take=3&cursor=${page1.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.activities).toHaveLength(2);
    expect(page2.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('filters by activityType and date', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const byType = await request(app).get('/v1/user/activity?activityType=SEARCH');
    expect(byType.status).toBe(200);
    expect(byType.body.activities).toHaveLength(1);
    expect(byType.body.activities[0].activityType).toBe('SEARCH');

    const byDate = await request(app).get(`/v1/user/activity?date=${today}`);
    expect(byDate.status).toBe(200);
    expect(byDate.body.activities).toHaveLength(5);
  });
});

describe('GET /v1/user/activity/stats', () => {
  it('returns aggregate counts and topMedia for the signed-in user', async () => {
    const res = await request(app).get('/v1/user/activity/stats');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalSearches: 1,
      totalExports: 1,
      totalPlays: 2,
      totalListAdds: 1,
    });
    expect(res.body.topMedia).toEqual(
      expect.arrayContaining([
        { mediaId: 42, count: 2 },
        { mediaId: 99, count: 1 },
      ]),
    );
  });
});

describe('GET /v1/user/activity/heatmap', () => {
  it('returns daily activity and supports activityType filter', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const all = await request(app).get('/v1/user/activity/heatmap?days=7');
    expect(all.status).toBe(200);
    expect(all.body.activityByDay[today]).toBe(5);

    const filtered = await request(app).get('/v1/user/activity/heatmap?days=7&activityType=SEARCH');
    expect(filtered.status).toBe(200);
    expect(filtered.body.activityByDay[today]).toBe(1);
  });
});

describe('DELETE /v1/user/activity', () => {
  it('clears only requested activity type for current user', async () => {
    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id }),
      -1,
      async () => {
        const res = await request(app).delete('/v1/user/activity?activityType=SEARCH');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ deletedCount: 1 });
      },
    );

    await assertNoDifference(
      () => UserActivity.countBy({ userId: fixtures.users.david.id }),
      async () => {},
    );
  });

  it('clears all activity when no filter is provided', async () => {
    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id }),
      -5,
      async () => {
        const res = await request(app).delete('/v1/user/activity');
        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(5);
      },
    );
  });
});

