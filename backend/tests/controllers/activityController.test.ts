import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { z } from 'zod/v3';
import * as schemas from 'generated/schemas';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { ActivityType, UserActivity } from '@app/models/UserActivity';
import { assertDifference, assertNoDifference } from '../helpers/assertions';
import { assertMatchesSchema } from '../helpers/openapiContract';

setupTestSuite();

const app = createTestApp();
let core: CoreFixtures;
let fixtures: LoadedFixtures;
const userActivityListResponseSchema = z.object({
  activities: z.array(schemas.s_UserActivity),
  pagination: schemas.s_OpaqueCursorPagination,
});

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
    assertMatchesSchema(userActivityListResponseSchema, page1.body, 'GET /v1/user/activity 200 (page 1)');
    expect(page1.body.activities).toHaveLength(3);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.activities.every((a: { searchQuery?: string }) => a.searchQuery !== 'other-user')).toBe(true);

    const page2 = await request(app).get(`/v1/user/activity?take=3&cursor=${page1.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    assertMatchesSchema(userActivityListResponseSchema, page2.body, 'GET /v1/user/activity 200 (page 2)');
    expect(page2.body.activities).toHaveLength(1);
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
    expect(byDate.body.activities).toHaveLength(4);
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
      totalShares: 0,
    });
    expect(res.body.topMedia).toEqual(
      expect.arrayContaining([
        { mediaId: 42, count: 1 },
        { mediaId: 99, count: 1 },
      ]),
    );
  });
});

describe('GET /v1/user/activity/heatmap', () => {
  it('returns daily activity broken down by type', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const res = await request(app).get('/v1/user/activity/heatmap?days=7');
    expect(res.status).toBe(200);

    const dayData = res.body.activityByDay[today];
    expect(dayData).toBeDefined();
    expect(dayData.SEARCH).toBe(1);
    expect(dayData.ANKI_EXPORT).toBe(1);
    expect(dayData.SEGMENT_PLAY).toBe(2);
  });
});

describe('POST /v1/user/activity', () => {
  it('tracks a SEGMENT_PLAY and returns 204', async () => {
    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id, activityType: ActivityType.SEGMENT_PLAY }),
      1,
      async () => {
        const res = await request(app).post('/v1/user/activity').send({
          activityType: 'SEGMENT_PLAY',
          segmentUuid: 'test-uuid',
          mediaId: 1,
          mediaName: 'Test Anime',
          japaneseText: 'テスト',
        });
        expect(res.status).toBe(204);
        // Wait for fire-and-forget to complete
        await new Promise((r) => setTimeout(r, 500));
      },
    );
  });

  it('tracks a SHARE and returns 204', async () => {
    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id, activityType: ActivityType.SHARE }),
      1,
      async () => {
        const res = await request(app).post('/v1/user/activity').send({
          activityType: 'SHARE',
          segmentUuid: 'shared-uuid',
          mediaId: 1,
          mediaName: 'Test Anime',
          japaneseText: 'テスト',
        });
        expect(res.status).toBe(204);
        await new Promise((r) => setTimeout(r, 500));
      },
    );
  });

  it('rejects activity types not in the allowed enum with 400', async () => {
    const res = await request(app).post('/v1/user/activity').send({
      activityType: 'SEARCH',
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/user/activity/date/:date', () => {
  it('deletes all activity for a specific date and returns deletedCount', async () => {
    const today = new Date().toISOString().slice(0, 10);

    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id }),
      -4,
      async () => {
        const res = await request(app).delete(`/v1/user/activity/date/${today}`);
        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(4);
      },
    );
  });

  it('returns deletedCount 0 when no activity exists for the date', async () => {
    const res = await request(app).delete('/v1/user/activity/date/2000-01-01');
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(0);
  });

  it('does not delete other users activity', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await request(app).delete(`/v1/user/activity/date/${today}`);

    const davidCount = await UserActivity.countBy({ userId: fixtures.users.david.id });
    expect(davidCount).toBe(1);
  });
});

describe('DELETE /v1/user/activity/:id', () => {
  it('deletes a single activity record and returns 204', async () => {
    const activity = await UserActivity.findOneByOrFail({ userId: fixtures.users.kevin.id });

    await assertDifference(
      () => UserActivity.countBy({ userId: fixtures.users.kevin.id }),
      -1,
      async () => {
        const res = await request(app).delete(`/v1/user/activity/${activity.id}`);
        expect(res.status).toBe(204);
      },
    );
  });

  it('returns 404 for non-existent activity', async () => {
    const res = await request(app).delete('/v1/user/activity/999999');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 when trying to delete another users activity', async () => {
    const davidActivity = await UserActivity.findOneByOrFail({ userId: fixtures.users.david.id });
    const res = await request(app).delete(`/v1/user/activity/${davidActivity.id}`);
    expect(res.status).toBe(404);
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
      -4,
      async () => {
        const res = await request(app).delete('/v1/user/activity');
        expect(res.status).toBe(200);
        expect(res.body.deletedCount).toBe(4);
      },
    );
  });
});
