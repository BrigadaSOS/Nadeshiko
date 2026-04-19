import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, afterEach, spyOn } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { assertDifference } from '../helpers/assertions';
import { SegmentDocument } from '@app/models/SegmentDocument';
import { setBossInstance } from '@app/workers/pgBossClient';
import { toSegmentDTO } from '@app/controllers/mappers/segmentMapper';
import { toMediaBaseDTO } from '@app/controllers/mappers/sharedMapper';
import { ContentRating, Segment, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { Media } from '@app/models/Media';
import { MediaExternalId, ExternalSourceType } from '@app/models/MediaExternalId';

setupTestSuite();

const app = createTestApp();

let core: CoreFixtures;
let segmentSeedCounter = 0;
const activeSpies: Array<{ mockRestore: () => void }> = [];
const MISSING_MEDIA_PUBLIC_ID = 'MissingMed01';
const MISSING_SEGMENT_PUBLIC_ID = 'MissSegm0012';

beforeAll(async () => {
  setBossInstance({
    sendDebounced: async () => 'test-job-id',
  } as any);
  core = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, core.users.kevin);
});

afterEach(() => {
  while (activeSpies.length > 0) {
    activeSpies.pop()?.mockRestore();
  }
});

async function seedSegment(mediaId: number, episodeNumber: number, overrides: Partial<Segment> = {}): Promise<Segment> {
  segmentSeedCounter += 1;

  const uuid = `seg-${mediaId}-${episodeNumber}-${segmentSeedCounter}`;
  return Segment.save({
    uuid,
    publicId: overrides.publicId ?? `seg${String(segmentSeedCounter).padStart(9, '0')}`,
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
  });
}

describe('GET /v1/media/:mediaId/episodes/:episodeNumber/segments', () => {
  it('returns paginated segments for an episode', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;

    await seedSegment(media.id, episode.episodeNumber, { position: 1 });
    await seedSegment(media.id, episode.episodeNumber, { position: 2 });
    await seedSegment(media.id, episode.episodeNumber, { position: 3 });

    const page1 = await request(app).get(
      `/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments?take=2`,
    );
    expect(page1.status).toBe(200);
    expect(page1.body.segments).toHaveLength(2);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.pagination.cursor).toEqual(expect.any(String));

    const page2 = await request(app).get(
      `/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments?take=2&cursor=${page1.body.pagination.cursor}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.segments).toHaveLength(1);
    expect(page2.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('returns empty list when episode exists but has no segments', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;

    const res = await request(app).get(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      segments: [],
      pagination: { hasMore: false, cursor: null },
    });
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).get(`/v1/media/${media.publicId}/episodes/999/segments`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /v1/media/:mediaId/episodes/:episodeNumber/segments', () => {
  it('creates a segment with deterministic uuid and defaults', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    await MediaExternalId.save({ mediaId: media.id, source: ExternalSourceType.ANILIST, externalId: '99999' });
    const position = 7;

    await assertDifference(
      () => Segment.count(),
      +1,
      async () => {
        const res = await request(app)
          .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments`)
          .send({
            position,
            startTimeMs: 1500,
            endTimeMs: 2500,
            textJa: { content: 'テスト' },
            textEn: { content: 'test', isMachineTranslated: false },
            textEs: { content: 'prueba', isMachineTranslated: false },
            storage: 'R2',
            hashedId: 'new-hash',
          });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          publicId: expect.any(String),
          mediaPublicId: media.publicId,
          episode: episode.episodeNumber,
          position,
          textJa: { content: 'テスト' },
          textEn: { content: 'test', isMachineTranslated: false },
          textEs: { content: 'prueba', isMachineTranslated: false },
          contentRating: 'SAFE',
          status: 'ACTIVE',
          hashedId: 'new-hash',
          storage: 'R2',
        });
      },
    );
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app)
      .post(`/v1/media/${MISSING_MEDIA_PUBLIC_ID}/episodes/1/segments`)
      .send({
        position: 1,
        startTimeMs: 0,
        endTimeMs: 1000,
        textJa: { content: 'ja' },
        textEn: { content: 'en' },
        textEs: { content: 'es' },
        hashedId: 'missing-media',
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 when episode does not exist (FK violation)', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;
    await MediaExternalId.save({ mediaId: media.id, source: ExternalSourceType.ANILIST, externalId: '99998' });

    const res = await request(app)
      .post(`/v1/media/${media.publicId}/episodes/999/segments`)
      .send({
        position: 1,
        startTimeMs: 0,
        endTimeMs: 1000,
        textJa: { content: 'ja' },
        textEn: { content: 'en' },
        textEs: { content: 'es' },
        hashedId: 'missing-episode',
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GET /v1/media/segments/:segmentPublicId', () => {
  it('returns a segment by publicId', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(media.id, episode.episodeNumber, { position: 5 });

    const res = await request(app).get(`/v1/media/segments/${segment.publicId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      publicId: segment.publicId,
      mediaPublicId: media.publicId,
      episode: episode.episodeNumber,
      position: 5,
    });
  });

  it('returns 404 when segment does not exist', async () => {
    const res = await request(app).get(`/v1/media/segments/${MISSING_SEGMENT_PUBLIC_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/segments/:segmentPublicId', () => {
  it('updates a segment and preserves falsy values', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(fixtures.media.testShow.id, episode.episodeNumber, {
      contentEsMt: true,
      contentEnMt: true,
      contentRating: ContentRating.SAFE,
    });

    const res = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({
        textJa: { content: '更新' },
        textEn: { content: 'updated-en', isMachineTranslated: false },
        textEs: { content: 'updated-es', isMachineTranslated: false },
        contentRating: 'QUESTIONABLE',
        status: 'HIDDEN',
        startTimeMs: 222,
        endTimeMs: 333,
        position: 9,
        storage: 'LOCAL',
        ratingAnalysis: { scores: { violence: 0.1 }, tags: { action: true } },
        posAnalysis: { nouns: 3 },
        hashedId: 'updated-hash',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      publicId: segment.publicId,
      position: 9,
      textJa: { content: '更新' },
      textEn: { content: 'updated-en', isMachineTranslated: false },
      textEs: { content: 'updated-es', isMachineTranslated: false },
      contentRating: 'QUESTIONABLE',
      status: 'HIDDEN',
      storage: 'LOCAL',
      hashedId: 'updated-hash',
    });

    const updated = await Segment.findOneByOrFail({ id: segment.id });
    expect(updated.contentJa).toBe('更新');
    expect(updated.contentEnMt).toBe(false);
    expect(updated.contentEsMt).toBe(false);
    expect(updated.contentRating).toBe(ContentRating.QUESTIONABLE);
    expect(updated.status).toBe(SegmentStatus.HIDDEN);
    expect(updated.storage).toBe(SegmentStorage.LOCAL);
    expect(updated.hashedId).toBe('updated-hash');
  });

  it('returns 404 when segment does not exist', async () => {
    const res = await request(app)
      .patch(`/v1/media/segments/${MISSING_SEGMENT_PUBLIC_ID}`)
      .send({
        textJa: { content: 'nope' },
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('GET /v1/media/segments/:publicId/context', () => {
  it('returns context from SegmentDocument and passes query parameters', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    const segment = await seedSegment(media.id, episode.episodeNumber, { position: 12 });

    const contextResponse = {
      segments: [toSegmentDTO(segment, media.publicId)],
      includes: {
        media: {
          [media.publicId]: toMediaBaseDTO(media as Media),
        },
      },
    };

    const surroundingSpy = spyOn(SegmentDocument, 'surroundingSegments').mockResolvedValueOnce(contextResponse as any);
    activeSpies.push(surroundingSpy);

    const res = await request(app).get(`/v1/media/segments/${segment.publicId}/context?take=5&contentRating=SAFE`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ segments: contextResponse.segments });
    expect(surroundingSpy).toHaveBeenCalledWith({
      mediaId: media.id,
      episodeNumber: episode.episodeNumber,
      segmentPosition: 12,
      limit: 5,
      contentRating: ['SAFE'],
    });
  });

  it('returns 404 when base segment publicId does not exist', async () => {
    const surroundingSpy = spyOn(SegmentDocument, 'surroundingSegments').mockResolvedValueOnce({
      segments: [],
      includes: { media: {} },
    } as any);
    activeSpies.push(surroundingSpy);

    const res = await request(app).get(`/v1/media/segments/${MISSING_SEGMENT_PUBLIC_ID}/context`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(surroundingSpy).not.toHaveBeenCalled();
  });
});
