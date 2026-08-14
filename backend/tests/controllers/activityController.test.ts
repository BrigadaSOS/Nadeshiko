import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { z } from 'zod/v4';
import * as schemas from 'generated/schemas';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures, type LoadedFixtures } from '../fixtures/loader';
import { ActivityType, UserActivity } from '@app/models/UserActivity';
import { UserMediaAffinity } from '@app/models/UserMediaAffinity';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { assertDifference, assertNoDifference } from '../helpers/assertions';
import { assertMatchesSchema } from '../helpers/openapiContract';

setupTestSuite();

const app = createTestApp();
let core: CoreFixtures;
let fixtures: LoadedFixtures;
const SEGMENT_PLAY_PUBLIC_ID = 'SegPlay00001';
const SHARE_PUBLIC_ID = 'ShareSeg0012';
// A second title for the tally tests. Synthetic on purpose: `UserMediaAffinity`
// keys media by public id with no foreign key to `Media`, and these assertions
// read the model directly, so no catalogue row has to exist for it.
const SECOND_MEDIA = 'FamiliarTst1';
const userActivityListResponseSchema = z.object({
  activities: z.array(schemas.s_UserActivity),
  pagination: schemas.s_CursorPagination,
});

const currentPeriod = () => AccountQuotaUsage.getCurrentPeriodYyyymm();
const periodMonthsAgo = (months: number) => {
  const now = new Date();
  return AccountQuotaUsage.getCurrentPeriodYyyymm(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)),
  );
};

beforeAll(async () => {
  core = await seedCoreFixtures();
});
beforeEach(async () => {
  fixtures = await loadFixtures(['singleMedia', 'kevinActivities', 'davidActivity'], { users: core.users });
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
    expect(Array.isArray(res.body.topMedia)).toBe(true);
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
          segmentPublicId: SEGMENT_PLAY_PUBLIC_ID,
          mediaPublicId: fixtures.media.testShow.publicId,
          mediaName: 'Test Anime',
          japaneseText: 'テスト',
        });
        expect(res.status).toBe(204);
        // Wait for fire-and-forget to complete
        await new Promise((r) => setTimeout(r, 1000));
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
          segmentPublicId: SHARE_PUBLIC_ID,
          mediaPublicId: fixtures.media.testShow.publicId,
          mediaName: 'Test Anime',
          japaneseText: 'テスト',
        });
        expect(res.status).toBe(204);
        await new Promise((r) => setTimeout(r, 1000));
      },
    );
  });

  /**
   * Repeating a search is not a second search worth remembering. Recording
   * happens on arrival -- a reload, a shared link and an extension link all
   * count -- so the same query used to pile up a row per visit.
   */
  describe('repeating a search', () => {
    const trackSearch = async (body: Record<string, unknown>) => {
      const res = await request(app)
        .post('/v1/user/activity')
        .send({ activityType: 'SEARCH', ...body });
      expect(res.status).toBe(204);
      // Tracking is fire-and-forget; the row lands after the response.
      await new Promise((r) => setTimeout(r, 1000));
    };

    const searchRows = (searchQuery: string) =>
      UserActivity.find({
        where: { userId: fixtures.users.kevin.id, activityType: ActivityType.SEARCH, searchQuery },
        order: { createdAt: 'DESC' },
      });

    it('bumps the row it already has today instead of adding another', async () => {
      await trackSearch({ searchQuery: 'repeated-today' });
      const [first] = await searchRows('repeated-today');
      expect(first).toBeDefined();

      await assertNoDifference(
        () => UserActivity.countBy({ userId: fixtures.users.kevin.id, searchQuery: 'repeated-today' }),
        async () => {
          await trackSearch({ searchQuery: 'repeated-today' });
        },
      );

      // The one row moves to now, because that is what the timeline orders by
      // and what the recents menu reads as "when you last ran this".
      const [after] = await searchRows('repeated-today');
      expect(after.id).toBe(first.id);
      expect(after.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    });

    it('keeps a search inside a title apart from the same search across everything', async () => {
      await trackSearch({ searchQuery: 'scoped-vs-not' });
      await assertDifference(
        () => UserActivity.countBy({ userId: fixtures.users.kevin.id, searchQuery: 'scoped-vs-not' }),
        1,
        async () => {
          await trackSearch({ searchQuery: 'scoped-vs-not', mediaPublicId: fixtures.media.testShow.publicId });
        },
      );

      // ...and the scoped one dedupes against itself, not against the other.
      await assertNoDifference(
        () => UserActivity.countBy({ userId: fixtures.users.kevin.id, searchQuery: 'scoped-vs-not' }),
        async () => {
          await trackSearch({ searchQuery: 'scoped-vs-not', mediaPublicId: fixtures.media.testShow.publicId });
        },
      );
    });

    it('starts a new row on a new day, so the heatmap keeps both', async () => {
      await trackSearch({ searchQuery: 'across-days' });
      const [today] = await searchRows('across-days');

      // Backdated rather than waiting for midnight: the dedup is scoped by
      // `DATE(created_at)`, so a row from yesterday must not be bumped.
      await UserActivity.update(today.id, { createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000) });

      await assertDifference(
        () => UserActivity.countBy({ userId: fixtures.users.kevin.id, searchQuery: 'across-days' }),
        1,
        async () => {
          await trackSearch({ searchQuery: 'across-days' });
        },
      );
    });

    it('still records every play, which really is two events', async () => {
      await assertDifference(
        () => UserActivity.countBy({ userId: fixtures.users.kevin.id, activityType: ActivityType.SEGMENT_PLAY }),
        2,
        async () => {
          for (let i = 0; i < 2; i++) {
            const res = await request(app).post('/v1/user/activity').send({
              activityType: 'SEGMENT_PLAY',
              segmentPublicId: SEGMENT_PLAY_PUBLIC_ID,
              mediaPublicId: fixtures.media.testShow.publicId,
            });
            expect(res.status).toBe(204);
            await new Promise((r) => setTimeout(r, 1000));
          }
        },
      );
    });
  });

  it('rejects activity types not in the allowed enum with 400', async () => {
    const res = await request(app).post('/v1/user/activity').send({
      activityType: 'INVALID_TYPE',
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
        expect(res.body.count).toBe(4);
      },
    );
  });

  it('returns deletedCount 0 when no activity exists for the date', async () => {
    const res = await request(app).delete('/v1/user/activity/date/2000-01-01');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
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
        expect(res.body).toMatchObject({ count: 1 });
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
        expect(res.body.count).toBe(4);
      },
    );
  });
});

describe('POST /v1/user/activity — media affinity', () => {
  // The database rolls back between tests, but `core.users.kevin` is a cached
  // object shared across them and `signInAs` reads it -- so preferences set by
  // an earlier test survive unless they are reset here.
  beforeEach(() => {
    core.users.kevin.preferences = {};
    signInAs(app, core.users.kevin);
  });

  const countAffinity = () => UserMediaAffinity.countBy({ userId: core.users.kevin.id });

  const trackExport = () =>
    request(app).post('/v1/user/activity').send({
      activityType: 'ANKI_EXPORT',
      segmentPublicId: SEGMENT_PLAY_PUBLIC_ID,
      mediaPublicId: fixtures.media.testShow.publicId,
      mediaName: 'Test Anime',
      japaneseText: 'テスト',
    });

  it('tallies an Anki export against the title', async () => {
    await assertDifference(countAffinity, 1, async () => {
      const res = await trackExport();
      expect(res.status).toBe(204);
    });

    const row = await UserMediaAffinity.findOneByOrFail({
      userId: core.users.kevin.id,
      mediaPublicId: fixtures.media.testShow.publicId,
    });
    expect(row.ankiCount).toBe(1);
  });

  it('increments rather than overwrites within the same month', async () => {
    // The regression `orUpdate()` would cause: a counter silently degraded to a
    // flag, staying at 1 however much the reader studies.
    await trackExport();
    await trackExport();

    const row = await UserMediaAffinity.findOneByOrFail({
      userId: core.users.kevin.id,
      mediaPublicId: fixtures.media.testShow.publicId,
    });
    expect(row.ankiCount).toBe(2);
  });

  it('records an autoplayed segment as activity but not as engagement', async () => {
    await assertNoDifference(countAffinity, async () => {
      const res = await request(app).post('/v1/user/activity').send({
        activityType: 'SEGMENT_PLAY',
        segmentPublicId: SEGMENT_PLAY_PUBLIC_ID,
        mediaPublicId: fixtures.media.testShow.publicId,
        autoplay: true,
      });
      expect(res.status).toBe(204);
    });

    // Still in the activity log -- it happened, it just is not evidence of study.
    const activityCount = await UserActivity.countBy({
      userId: core.users.kevin.id,
      activityType: ActivityType.SEGMENT_PLAY,
    });
    expect(activityCount).toBeGreaterThan(0);
  });

  it('never tallies a SEARCH, even one scoped to a title', async () => {
    await assertNoDifference(countAffinity, async () => {
      const res = await request(app).post('/v1/user/activity').send({
        activityType: 'SEARCH',
        searchQuery: 'テスト',
        mediaPublicId: fixtures.media.testShow.publicId,
      });
      expect(res.status).toBe(204);
    });
  });

  it('keeps tallying for a reader who turned search history off', async () => {
    core.users.kevin.preferences = { searchHistory: { enabled: false } };
    await core.users.kevin.save();
    signInAs(app, core.users.kevin);

    await assertDifference(countAffinity, 1, async () => {
      const res = await trackExport();
      expect(res.status).toBe(204);
    });

    // The two consents are independent: no activity row, but a tally row.
    await assertNoDifference(
      () => UserActivity.countBy({ userId: core.users.kevin.id, activityType: ActivityType.ANKI_EXPORT }),
      async () => {
        await trackExport();
      },
    );
  });

  it('stops tallying for a reader who turned the tally off, while history keeps running', async () => {
    core.users.kevin.preferences = { familiarMedia: { enabled: false } };
    await core.users.kevin.save();
    signInAs(app, core.users.kevin);

    await assertNoDifference(countAffinity, async () => {
      const res = await trackExport();
      expect(res.status).toBe(204);
    });

    await assertDifference(
      () => UserActivity.countBy({ userId: core.users.kevin.id, activityType: ActivityType.ANKI_EXPORT }),
      1,
      async () => {
        await trackExport();
      },
    );
  });
});

describe('familiar media', () => {
  beforeEach(() => {
    core.users.kevin.preferences = {};
    signInAs(app, core.users.kevin);
  });

  it('ranks a mined title above a merely played one', async () => {
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: currentPeriod(),
        ankiCount: 2,
      }),
    ]);

    const res = await request(app).get('/v1/user/familiar-media');

    expect(res.status).toBe(200);
    expect(res.body.familiarMedia[0]).toMatchObject({ media: { publicId: fixtures.media.testShow.publicId } });
    // 2 exports = 16 points, comfortably past MIN_SCORE.
    expect(res.body.familiarMedia[0].score).toBeGreaterThanOrEqual(16);
  });

  it('ignores a title below the score floor', async () => {
    // Two stray plays: log2(3) * 2 ≈ 3.2, under MIN_SCORE of 5.
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: currentPeriod(),
        playCount: 2,
      }),
    ]);

    const res = await request(app).get('/v1/user/familiar-media');

    expect(res.status).toBe(200);
    expect(res.body.familiarMedia).toEqual([]);
  });

  it('ignores tallies older than the window', async () => {
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: periodMonthsAgo(13),
        ankiCount: 50,
      }),
    ]);

    const res = await request(app).get('/v1/user/familiar-media');

    expect(res.status).toBe(200);
    expect(res.body.familiarMedia).toEqual([]);
  });

  it('returns nothing while the reader has the tally switched off', async () => {
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: currentPeriod(),
        ankiCount: 5,
      }),
    ]);
    core.users.kevin.preferences = { familiarMedia: { enabled: false } };
    await core.users.kevin.save();
    signInAs(app, core.users.kevin);

    const res = await request(app).get('/v1/user/familiar-media');

    expect(res.status).toBe(200);
    expect(res.body.familiarMedia).toEqual([]);
  });

  it('forgets one title and leaves the rest of the tally standing', async () => {
    const other = fixtures.media.testShow.publicId;
    await UserMediaAffinity.incrementForUser(fixtures.users.kevin.id, other, ActivityType.ANKI_EXPORT);
    await UserMediaAffinity.incrementForUser(fixtures.users.kevin.id, SECOND_MEDIA, ActivityType.ANKI_EXPORT);

    const before = await UserMediaAffinity.getFamiliarForUser(fixtures.users.kevin.id);
    expect(before.map((e) => e.mediaPublicId).sort()).toEqual([other, SECOND_MEDIA].sort());

    const res = await request(app).delete(`/v1/user/familiar-media/${other}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);

    const after = await UserMediaAffinity.getFamiliarForUser(fixtures.users.kevin.id);
    expect(after.map((e) => e.mediaPublicId)).toEqual([SECOND_MEDIA]);
  });

  it('answers 200 with count 0 for a title that was never tallied', async () => {
    // The caller is a reader pressing a button beside a list; "nothing to
    // forget" is the same outcome to them as "forgotten".
    const res = await request(app).delete(`/v1/user/familiar-media/${SECOND_MEDIA}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  it("cannot reach another reader's tally", async () => {
    const other = fixtures.media.testShow.publicId;
    await UserMediaAffinity.incrementForUser(core.users.regular.id, other, ActivityType.ANKI_EXPORT);

    const res = await request(app).delete(`/v1/user/familiar-media/${other}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);

    // The other reader's row is untouched: the id in the path only ever scopes to the caller.
    const theirs = await UserMediaAffinity.getFamiliarForUser(core.users.regular.id);
    expect(theirs.map((e) => e.mediaPublicId)).toContain(other);
  });

  it('clears the tally without touching activity history, and vice versa', async () => {
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: currentPeriod(),
        ankiCount: 5,
      }),
    ]);
    const activityBefore = await UserActivity.countBy({ userId: core.users.kevin.id });
    expect(activityBefore).toBeGreaterThan(0);

    const cleared = await request(app).delete('/v1/user/familiar-media');

    expect(cleared.status).toBe(200);
    expect(cleared.body.count).toBe(1);
    expect(await UserMediaAffinity.countBy({ userId: core.users.kevin.id })).toBe(0);
    expect(await UserActivity.countBy({ userId: core.users.kevin.id })).toBe(activityBefore);

    // And the mirror image: clearing history leaves the tally standing.
    await UserMediaAffinity.save([
      UserMediaAffinity.create({
        userId: core.users.kevin.id,
        mediaPublicId: fixtures.media.testShow.publicId,
        periodYyyymm: currentPeriod(),
        ankiCount: 5,
      }),
    ]);
    await request(app).delete('/v1/user/activity');

    expect(await UserMediaAffinity.countBy({ userId: core.users.kevin.id })).toBe(1);
  });
});
