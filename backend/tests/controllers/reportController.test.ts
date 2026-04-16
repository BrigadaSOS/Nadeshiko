import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { UserRoutes, AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import { MediaAuditRun, Segment } from '@app/models';
import { ContentRating, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { Report, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';
import { setBossInstance } from '@app/workers/pgBossClient';

setupTestSuite();

let app: Application;
let core: CoreFixtures;
let segmentSeedCounter = 0;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: {
        kind: ApiKeyKind.SERVICE,
        permissions: Object.values(ApiPermission),
      },
    };
  }
  next();
}

function signInAs(targetApp: Application, user: CoreFixtures['users']['regular'] | null) {
  targetApp.locals.testUser = user;
}

async function seedSegment(mediaId: number, episodeNumber: number, overrides: Partial<Segment> = {}): Promise<Segment> {
  segmentSeedCounter += 1;

  const uuid = `report-seg-${mediaId}-${episodeNumber}-${segmentSeedCounter}`;
  return Segment.save({
    uuid,
    publicId: `pub-${uuid}`,
    position: segmentSeedCounter,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 1000,
    endTimeMs: 2000,
    contentJa: `ja-${segmentSeedCounter}`,
    contentEn: `en-${segmentSeedCounter}`,
    contentEnMt: false,
    contentEs: `es-${segmentSeedCounter}`,
    contentEsMt: false,
    contentRating: ContentRating.SAFE,
    ratingAnalysis: { scores: {}, tags: {} },
    posAnalysis: { nouns: 0 },
    storage: SegmentStorage.R2,
    hashedId: `hash-${segmentSeedCounter}`,
    storageBasePath: '/test',
    mediaId,
    episode: episodeNumber,
    ...overrides,
  } as Partial<Segment>) as Promise<Segment>;
}

beforeAll(async () => {
  setBossInstance({
    sendDebounced: async () => 'test-job-id',
  } as any);

  core = await seedCoreFixtures();
  app = buildApplication({
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (appInstance) => {
      appInstance.use('/', UserRoutes);
      appInstance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  signInAs(app, core.users.regular);
});

describe('POST /v1/user/reports', () => {
  it('creates a media report', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'MEDIA',
          mediaId: media.publicId,
        },
        reason: 'OTHER',
        description: 'metadata mismatch',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: 'USER',
      target: {
        type: 'MEDIA',
        mediaId: media.publicId,
      },
      reason: 'OTHER',
      description: 'metadata mismatch',
      status: 'OPEN',
      userId: core.users.regular.id,
    });

    const saved = await Report.findOneByOrFail({ id: res.body.id });
    expect(saved.targetType).toBe(ReportTargetType.MEDIA);
    expect(saved.targetMediaId).toBe(media.id);
    expect(saved.description).toBe('metadata mismatch');
  });

  it('creates a segment report with episode number', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(media.id, episode.episodeNumber);

    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'SEGMENT',
          mediaId: media.publicId,
          episodeNumber: episode.episodeNumber,
          segmentId: segment.publicId,
        },
        reason: 'WRONG_TRANSLATION',
        description: 'english text is wrong',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: 'USER',
      target: {
        type: 'SEGMENT',
        mediaId: media.publicId,
        episodeNumber: episode.episodeNumber,
        segmentId: segment.publicId,
      },
      reason: 'WRONG_TRANSLATION',
      status: 'OPEN',
    });

    const saved = await Report.findOneByOrFail({ id: res.body.id });
    expect(saved.targetType).toBe(ReportTargetType.SEGMENT);
    expect(saved.targetSegmentId).toBe(segment.id);
    expect(saved.targetEpisodeNumber).toBe(episode.episodeNumber);
  });

  it('returns 404 when target media does not exist', async () => {
    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'MEDIA',
          mediaId: 'nonexistent',
        },
        reason: 'OTHER',
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 when target segment does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'SEGMENT',
          mediaId: media.publicId,
          segmentId: 'missing-segment',
        },
        reason: 'WRONG_TRANSLATION',
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 400 when segment mediaId does not match', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const extraMedia = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const wrongMedia = extraMedia.media.testShow;
    const segment = await seedSegment(media.id, episode.episodeNumber);

    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'SEGMENT',
          mediaId: wrongMedia.publicId,
          segmentId: segment.publicId,
        },
        reason: 'WRONG_TRANSLATION',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 400 when segment episodeNumber does not match', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(media.id, episode.episodeNumber);

    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'SEGMENT',
          mediaId: media.publicId,
          episodeNumber: episode.episodeNumber + 1,
          segmentId: segment.publicId,
        },
        reason: 'WRONG_TRANSLATION',
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('GET /v1/admin/reports', () => {
  it('returns empty list when there are no reports', async () => {
    const res = await request(app).get('/v1/admin/reports');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      groups: [],
      pagination: { hasMore: false, cursor: null },
    });
  });

  it('groups reports by target and returns individual reports within each group', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const seg1 = await seedSegment(media.id, episode.episodeNumber);
    const auditRun = (await MediaAuditRun.save({
      auditName: 'db-es-sync-issues',
      category: 'ANIME',
      resultCount: 2,
      thresholdUsed: { maxMismatchRatio: 0.1 },
    })) as MediaAuditRun;

    // Two reports for the same target (different reasons) -> one group with 2 individual reports
    await Report.save({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: media.id,
      targetEpisodeNumber: episode.episodeNumber,
      targetSegmentId: seg1.id,
      reason: ReportReason.DB_ES_SYNC_ISSUES,
      status: ReportStatus.PROCESSING,
      auditRunId: auditRun.id,
      userId: null,
    });

    await Report.save({
      source: ReportSource.AUTO,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: media.id,
      targetEpisodeNumber: episode.episodeNumber,
      targetSegmentId: seg1.id,
      reason: ReportReason.BAD_SEGMENT_RATIO,
      status: ReportStatus.PROCESSING,
      auditRunId: auditRun.id,
      userId: null,
    });

    const res = await request(app).get(
      `/v1/admin/reports?status=PROCESSING&source=AUTO&target.type=SEGMENT&target.mediaId=${media.id}&target.episodeNumber=${episode.episodeNumber}&target.segmentId=${seg1.id}&auditRunId=${auditRun.id}&take=20`,
    );

    expect(res.status).toBe(200);
    // One target group containing both reports
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0]).toMatchObject({
      target: {
        type: 'SEGMENT',
        mediaId: media.publicId,
        episodeNumber: episode.episodeNumber,
        segmentId: seg1.publicId,
      },
      status: 'PROCESSING',
      reportCount: 2,
    });
    expect(res.body.groups[0].reports).toHaveLength(2);
  });
});

describe('PATCH /v1/admin/reports/:id', () => {
  it('updates report status and admin notes', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const report = (await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      reason: ReportReason.OTHER,
      status: ReportStatus.OPEN,
      userId: core.users.regular.id,
    })) as Report;

    const res = await request(app).patch(`/v1/admin/reports/${report.id}`).send({
      status: 'FIXED',
      adminNotes: 'Confirmed and queued fix',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: report.id,
      status: 'FIXED',
      adminNotes: 'Confirmed and queued fix',
    });

    const updated = await Report.findOneByOrFail({ id: report.id });
    expect(updated.status).toBe(ReportStatus.FIXED);
    expect(updated.adminNotes).toBe('Confirmed and queued fix');
  });

  it('returns 404 when report does not exist', async () => {
    const res = await request(app).patch('/v1/admin/reports/999999').send({
      status: 'FIXED',
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
