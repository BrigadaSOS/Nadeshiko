import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';

import { UserActivity, ActivityType } from '@app/models/UserActivity';
import { Collection, CollectionVisibility } from '@app/models/Collection';
import { CollectionSegment } from '@app/models/CollectionSegment';
import { Report, ReportSource, ReportTargetType, ReportReason } from '@app/models/Report';
import { User } from '@app/models/User';
import { Segment, SegmentStatus, SegmentStorage, ContentRating } from '@app/models/Segment';

let segmentCounter = 0;
async function createTestSegment(mediaId: number): Promise<Segment> {
  segmentCounter += 1;
  const uuid = `export-seg-${segmentCounter}`;
  return Segment.save({
    uuid,
    publicId: `pub-${uuid}`,
    position: segmentCounter,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 0,
    endTimeMs: 1000,
    contentJa: 'テスト',
    contentEs: 'prueba',
    contentEn: 'test',
    contentRating: ContentRating.SAFE,
    ratingAnalysis: { scores: {}, tags: {} },
    posAnalysis: { nouns: 0 },
    storage: SegmentStorage.R2,
    hashedId: `hash-export-${segmentCounter}`,
    episode: 1,
    mediaId,
    storageBasePath: '/test',
  });
}

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/user/export', () => {
  it('returns profile, preferences, and empty arrays when user has no data', async () => {
    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      profile: {
        id: fixtures.users.kevin.id,
        username: 'kevin',
        email: 'kevin@nadeshiko.test',
      },
      activity: [],
      collections: [],
      reports: [],
    });
    expect(res.body.profile.createdAt).toBeDefined();
    expect(res.body.preferences).toBeDefined();
  });

  it('includes activity records for the user', async () => {
    await UserActivity.save({
      userId: fixtures.users.kevin.id,
      activityType: ActivityType.SEARCH,
      searchQuery: '猫',
      mediaName: 'Test Anime',
    });
    await UserActivity.save({
      userId: fixtures.users.kevin.id,
      activityType: ActivityType.ANKI_EXPORT,
      segmentId: 999,
    });

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body.activity).toEqualUnordered([
      expect.objectContaining({ activityType: 'SEARCH', searchQuery: '猫' }),
      expect.objectContaining({ activityType: 'ANKI_EXPORT', segmentId: 999 }),
    ]);
  });

  it('includes collections with ordered segment IDs', async () => {
    const mediaFixtures = await loadFixtures(['mediaWithEpisode']);
    const media = mediaFixtures.media.testShow;
    const segA = await createTestSegment(media.id);
    const segB = await createTestSegment(media.id);
    const collection = await Collection.save({
      name: 'My Favorites',
      userId: fixtures.users.kevin.id,
      visibility: CollectionVisibility.PRIVATE,
    });

    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: segB.id,
      mediaId: media.id,
      position: 2,
      note: null,
    });
    await CollectionSegment.save({
      collectionId: collection.id,
      segmentId: segA.id,
      mediaId: media.id,
      position: 1,
      note: null,
    });

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      collections: [{ name: 'My Favorites', segmentIds: [segA.id, segB.id] }],
    });
    expect(res.body.collections).toHaveLength(1);
  });

  it('includes reports for the user', async () => {
    const mediaFixtures = await loadFixtures(['singleMedia']);
    const media = mediaFixtures.media.testShow;

    await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      reason: ReportReason.WRONG_METADATA,
      description: 'Wrong cover image',
      userId: fixtures.users.kevin.id,
    });

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      reports: [{ reason: 'WRONG_METADATA', target: { type: 'MEDIA', mediaId: media.id } }],
    });
    expect(res.body.reports).toHaveLength(1);
  });

  it('orders activity and reports by newest first', async () => {
    const mediaFixtures = await loadFixtures(['singleMedia']);
    const media = mediaFixtures.media.testShow;

    const oldActivity = await UserActivity.save({
      userId: fixtures.users.kevin.id,
      activityType: ActivityType.SEARCH,
      searchQuery: 'older',
    });
    const newActivity = await UserActivity.save({
      userId: fixtures.users.kevin.id,
      activityType: ActivityType.SEARCH,
      searchQuery: 'newer',
    });

    const oldReport = await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      reason: ReportReason.WRONG_METADATA,
      userId: fixtures.users.kevin.id,
    });
    const newReport = await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      reason: ReportReason.WRONG_METADATA,
      userId: fixtures.users.kevin.id,
    });

    await TestDataSource.query('UPDATE "UserActivity" SET "created_at" = $1 WHERE "id" = $2', [
      '2026-01-01T00:00:00.000Z',
      oldActivity.id,
    ]);
    await TestDataSource.query('UPDATE "UserActivity" SET "created_at" = $1 WHERE "id" = $2', [
      '2026-01-02T00:00:00.000Z',
      newActivity.id,
    ]);
    await TestDataSource.query('UPDATE "Report" SET "created_at" = $1 WHERE "id" = $2', [
      '2026-01-01T00:00:00.000Z',
      oldReport.id,
    ]);
    await TestDataSource.query('UPDATE "Report" SET "created_at" = $1 WHERE "id" = $2', [
      '2026-01-02T00:00:00.000Z',
      newReport.id,
    ]);

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body.activity[0]).toMatchObject({ id: newActivity.id, searchQuery: 'newer' });
    expect(res.body.activity[1]).toMatchObject({ id: oldActivity.id, searchQuery: 'older' });
    expect(res.body.reports[0]).toMatchObject({ id: newReport.id });
    expect(res.body.reports[1]).toMatchObject({ id: oldReport.id });
  });

  it('does not include other users data', async () => {
    await UserActivity.save({
      userId: fixtures.users.david.id,
      activityType: ActivityType.SEARCH,
      searchQuery: 'david search',
    });
    await Collection.save({
      name: 'David Collection',
      userId: fixtures.users.david.id,
      visibility: CollectionVisibility.PRIVATE,
    });
    const mediaFixtures = await loadFixtures(['singleMedia']);
    const media = mediaFixtures.media.testShow;
    await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      reason: ReportReason.WRONG_METADATA,
      userId: fixtures.users.david.id,
    });

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      activity: [],
      collections: [],
      reports: [],
    });
  });

  it('loads fresh user preferences from DB (not stale auth object)', async () => {
    await User.update(
      { id: fixtures.users.kevin.id },
      {
        preferences: {
          searchHistory: { enabled: false },
          blogLastVisited: '2026-01-20T10:00:00.000Z',
        },
      },
    );

    fixtures.users.kevin.preferences = {};
    signInAs(app, fixtures.users.kevin);

    const res = await request(app).get('/v1/user/export');

    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual({
      searchHistory: { enabled: false },
      blogLastVisited: '2026-01-20T10:00:00.000Z',
    });
  });
});
