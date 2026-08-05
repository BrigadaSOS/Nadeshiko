import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
    rateLimit: false,
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
          mediaPublicId: media.publicId,
        },
        reason: 'OTHER',
        description: 'metadata mismatch',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: 'USER',
      target: {
        type: 'MEDIA',
        mediaPublicId: media.publicId,
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
          mediaPublicId: media.publicId,
          episodeNumber: episode.episodeNumber,
          segmentPublicId: segment.publicId,
        },
        reason: 'WRONG_TRANSLATION',
        description: 'english text is wrong',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      source: 'USER',
      target: {
        type: 'SEGMENT',
        mediaPublicId: media.publicId,
        episodeNumber: episode.episodeNumber,
        segmentPublicId: segment.publicId,
      },
      reason: 'WRONG_TRANSLATION',
      status: 'OPEN',
    });

    const saved = await Report.findOneByOrFail({ id: res.body.id });
    expect(saved.targetType).toBe(ReportTargetType.SEGMENT);
    expect(saved.targetSegmentId).toBe(segment.id);
    expect(saved.targetEpisodeNumber).toBe(episode.episodeNumber);
  });

  it('returns the existing report rather than creating a second one', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;
    const body = {
      target: { type: 'MEDIA', mediaPublicId: media.publicId },
      reason: 'OTHER',
      description: 'metadata mismatch',
    };

    const first = await request(app).post('/v1/user/reports').send(body);
    const second = await request(app).post('/v1/user/reports').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await Report.countBy({ targetMediaId: media.id, userId: core.users.regular.id })).toBe(1);
  });

  it('is the database, not the controller, that refuses the duplicate', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const first = await request(app)
      .post('/v1/user/reports')
      .send({
        target: { type: 'MEDIA', mediaPublicId: media.publicId },
        reason: 'OTHER',
      });
    expect(first.status).toBe(201);

    // Two concurrent submissions are not reproducible inside one transactional
    // test, so go straight at the guarantee the controller leans on: an identical
    // row is refused even when nothing looks first. Nothing may query after this
    // — the rejected statement leaves the surrounding transaction aborted.
    const duplicate = Report.create({
      source: ReportSource.USER,
      targetType: ReportTargetType.MEDIA,
      targetMediaId: media.id,
      targetEpisodeNumber: null,
      targetSegmentId: null,
      reason: ReportReason.OTHER,
      status: ReportStatus.OPEN,
      userId: core.users.regular.id,
    });

    await expect(duplicate.save()).rejects.toMatchObject({ driverError: { code: '23505' } });
  });

  it('still allows the same reason on a different segment of the same media', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const firstSegment = await seedSegment(media.id, episode.episodeNumber);
    const secondSegment = await seedSegment(media.id, episode.episodeNumber);

    const reportSegment = (segmentPublicId: string) =>
      request(app)
        .post('/v1/user/reports')
        .send({
          target: {
            type: 'SEGMENT',
            mediaPublicId: media.publicId,
            episodeNumber: episode.episodeNumber,
            segmentPublicId,
          },
          reason: 'WRONG_TRANSLATION',
        });

    const firstRes = await reportSegment(firstSegment.publicId);
    const secondRes = await reportSegment(secondSegment.publicId);

    expect(firstRes.status).toBe(201);
    expect(secondRes.status).toBe(201);
    expect(secondRes.body.id).not.toBe(firstRes.body.id);
    expect(await Report.countBy({ targetMediaId: media.id, userId: core.users.regular.id })).toBe(2);
  });

  it('does not mistake a segment report for a report about the media itself', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(media.id, episode.episodeNumber);

    const segmentRes = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'SEGMENT',
          mediaPublicId: media.publicId,
          episodeNumber: episode.episodeNumber,
          segmentPublicId: segment.publicId,
        },
        reason: 'OTHER',
      });

    // The old duplicate lookup passed `undefined` for a missing segment id, which
    // TypeORM drops from the WHERE entirely — so reporting the media came back
    // with the segment report above instead of creating its own.
    const mediaRes = await request(app)
      .post('/v1/user/reports')
      .send({
        target: { type: 'MEDIA', mediaPublicId: media.publicId },
        reason: 'OTHER',
      });

    expect(segmentRes.status).toBe(201);
    expect(mediaRes.status).toBe(201);
    expect(mediaRes.body.id).not.toBe(segmentRes.body.id);
    expect(mediaRes.body.target).toMatchObject({ type: 'MEDIA' });
  });

  it('does not constrain AUTO reports, which repeat per audit run', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    // The audit runner writes one report per run for the same target, with no
    // user_id. The index is partial so those are untouched by it.
    const buildAutoReport = () =>
      Report.create({
        source: ReportSource.AUTO,
        targetType: ReportTargetType.MEDIA,
        targetMediaId: media.id,
        targetEpisodeNumber: null,
        targetSegmentId: null,
        reason: ReportReason.LOW_SEGMENT_MEDIA,
        status: ReportStatus.OPEN,
        userId: null,
      });

    await buildAutoReport().save();
    await buildAutoReport().save();

    expect(await Report.countBy({ targetMediaId: media.id, source: ReportSource.AUTO })).toBe(2);
  });

  it('returns 404 when target media does not exist', async () => {
    const res = await request(app)
      .post('/v1/user/reports')
      .send({
        target: {
          type: 'MEDIA',
          mediaPublicId: 'nonexistent',
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
          mediaPublicId: media.publicId,
          segmentPublicId: 'missing-segment',
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
          mediaPublicId: wrongMedia.publicId,
          segmentPublicId: segment.publicId,
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
          mediaPublicId: media.publicId,
          episodeNumber: episode.episodeNumber + 1,
          segmentPublicId: segment.publicId,
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
        mediaPublicId: media.publicId,
        episodeNumber: episode.episodeNumber,
        segmentPublicId: seg1.publicId,
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
