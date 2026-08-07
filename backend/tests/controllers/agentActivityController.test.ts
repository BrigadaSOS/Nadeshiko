import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { MediaRoutes, AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';
import { ContentRating, Segment, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { SegmentRevision, RevisionActor } from '@app/models/SegmentRevision';
import { Report, ReportReason, ReportSource, ReportStatus, ReportTargetType } from '@app/models/Report';
import { resolveRevisionActor } from '@app/controllers/segmentController';
import { setBossInstance } from '@app/workers/pgBossClient';

setupTestSuite();

let app: Application;
let core: CoreFixtures;
let seedCounter = 0;

/**
 * The kind of credential is what the middleware varies, so it is a parameter here.
 * A service key is the moderation agent; a session is a person.
 */
let currentApiKeyKind: ApiKeyKind | null = ApiKeyKind.SERVICE;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth =
      currentApiKeyKind === null
        ? { type: AuthType.SESSION }
        : {
            type: AuthType.API_KEY,
            apiKey: { kind: currentApiKeyKind, permissions: Object.values(ApiPermission) },
          };
  }
  next();
}

async function seedSegment(mediaId: number, episodeNumber: number, overrides: Partial<Segment> = {}): Promise<Segment> {
  seedCounter += 1;
  const uuid = `agent-seg-${mediaId}-${episodeNumber}-${seedCounter}`;
  return Segment.save({
    uuid,
    // The route's path param is `^[A-Za-z0-9_-]{12}$`, so a shorter id is rejected
    // by validation before the controller ever runs.
    publicId: `agentsg${String(seedCounter).padStart(5, '0')}`,
    position: seedCounter,
    status: SegmentStatus.ACTIVE,
    startTimeMs: 1000,
    endTimeMs: 2000,
    contentJa: `ja-${seedCounter}`,
    contentEn: `en-${seedCounter}`,
    contentEnMt: false,
    contentEs: `es-${seedCounter}`,
    contentEsMt: false,
    contentRating: ContentRating.SAFE,
    ratingAnalysis: { scores: {}, tags: {} },
    storage: SegmentStorage.R2,
    hashedId: `hash-agent-${seedCounter}`,
    storageBasePath: '/test',
    mediaId,
    episode: episodeNumber,
    ...overrides,
  } as Partial<Segment>) as Promise<Segment>;
}

beforeAll(async () => {
  setBossInstance({ sendDebounced: async () => 'test-job-id' } as any);
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', MediaRoutes);
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(() => {
  currentApiKeyKind = ApiKeyKind.SERVICE;
  app.locals.testUser = core.users.kevin;
});

describe('resolveRevisionActor', () => {
  it('treats a service API key as the agent', () => {
    const actor = resolveRevisionActor({
      auth: { type: AuthType.API_KEY, apiKey: { kind: ApiKeyKind.SERVICE } },
    });
    expect(actor).toBe(RevisionActor.AGENT);
  });

  it('treats a user API key as a person', () => {
    const actor = resolveRevisionActor({
      auth: { type: AuthType.API_KEY, apiKey: { kind: ApiKeyKind.USER } },
    });
    expect(actor).toBe(RevisionActor.HUMAN);
  });

  it('treats a session as a person', () => {
    expect(resolveRevisionActor({ auth: { type: AuthType.SESSION } })).toBe(RevisionActor.HUMAN);
  });

  // Absent auth reaching a write would be a bug elsewhere, but defaulting to AGENT
  // would quietly file a human's edit into the agent's audit trail.
  it('defaults to a person when there is no auth at all', () => {
    expect(resolveRevisionActor({})).toBe(RevisionActor.HUMAN);
  });
});

describe('GET /v1/admin/agent-activity', () => {
  it('returns agent edits with the before/after pair and the triggering report', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const segment = await seedSegment(media.id, fixtures.episodes.pilot.episodeNumber, { contentEn: 'before' });

    const report = (await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: media.id,
      targetEpisodeNumber: fixtures.episodes.pilot.episodeNumber,
      targetSegmentId: segment.id,
      reason: ReportReason.WRONG_TRANSLATION,
      status: ReportStatus.OPEN,
      userId: core.users.regular.id,
    })) as Report;

    const patch = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textEn: { content: 'after' }, reportId: report.id });
    expect(patch.status).toBe(200);

    const res = await request(app).get('/v1/admin/agent-activity');

    expect(res.status).toBe(200);
    const entry = res.body.entries.find((e: any) => e.segmentPublicId === segment.publicId);
    expect(entry).toBeDefined();
    expect(entry.snapshot.contentEn).toBe('before');
    expect(entry.current.contentEn).toBe('after');
    expect(entry.reportId).toBe(report.id);
    expect(entry.mediaPublicId).toBe(media.publicId);
    // The revision number is what the caller passes to the restore endpoint.
    expect(entry.revisionNumber).toBe(1);
  });

  it('excludes edits made by a person', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber);

    currentApiKeyKind = null; // session auth -- a human editing by hand
    const patch = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textEn: { content: 'human edit' } });
    expect(patch.status).toBe(200);

    expect(await SegmentRevision.countBy({ segmentId: segment.id, actor: RevisionActor.HUMAN })).toBe(1);

    currentApiKeyKind = ApiKeyKind.SERVICE;
    const res = await request(app).get('/v1/admin/agent-activity');

    expect(res.body.entries.some((e: any) => e.segmentPublicId === segment.publicId)).toBe(false);
  });

  it('filters to a single report', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const wanted = await seedSegment(media.id, fixtures.episodes.pilot.episodeNumber);
    const other = await seedSegment(media.id, fixtures.episodes.pilot.episodeNumber);

    const report = (await Report.save({
      source: ReportSource.USER,
      targetType: ReportTargetType.SEGMENT,
      targetMediaId: media.id,
      targetEpisodeNumber: fixtures.episodes.pilot.episodeNumber,
      targetSegmentId: wanted.id,
      reason: ReportReason.WRONG_TIMING,
      status: ReportStatus.OPEN,
      userId: core.users.regular.id,
    })) as Report;

    await request(app)
      .patch(`/v1/media/segments/${wanted.publicId}`)
      .send({ textEn: { content: 'for the report' }, reportId: report.id });
    await request(app)
      .patch(`/v1/media/segments/${other.publicId}`)
      .send({ textEn: { content: 'unrelated' } });

    const res = await request(app).get(`/v1/admin/agent-activity?reportId=${report.id}`);

    expect(res.status).toBe(200);
    const ids = res.body.entries.map((e: any) => e.segmentPublicId);
    expect(ids).toContain(wanted.publicId);
    expect(ids).not.toContain(other.publicId);
  });

  it('honours the since window', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber);

    await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textEn: { content: 'recent' } });

    const future = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app).get(`/v1/admin/agent-activity?since=${encodeURIComponent(future)}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });
});
