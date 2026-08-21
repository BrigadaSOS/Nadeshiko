import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { setupTestSuite, createTestApp, signInAs, TestDataSource } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { assertDifference } from '../helpers/assertions';
import { setBossInstance } from '@app/workers/pgBossClient';
import { TOKEN_PARSE_QUEUE } from '@app/workers/queueNames';
import { toSegmentDTO } from '@app/controllers/mappers/segmentMapper';
import { toMediaBaseDTO } from '@app/controllers/mappers/sharedMapper';
import { ContentRating, Segment, SegmentStatus, SegmentStorage } from '@app/models/Segment';
import { SegmentRevision } from '@app/models/SegmentRevision';
import { Media } from '@app/models/Media';
import { MediaExternalId, ExternalSourceType } from '@app/models/MediaExternalId';
import * as SegmentContext from '@app/services/search/segmentDocument/SegmentContext';

setupTestSuite();

const app = createTestApp();

let core: CoreFixtures;
let segmentSeedCounter = 0;
const activeSpies: Array<{ mockRestore: () => void }> = [];
const MISSING_MEDIA_PUBLIC_ID = 'MissingMed01';
const MISSING_SEGMENT_PUBLIC_ID = 'MissSegm0012';

const bossSendDebounced = vi.fn(async () => 'test-job-id');
const bossInsert = vi.fn(async () => ['test-job-id']);

/** The segment ids a queue was asked to work on during the current test. */
function enqueuedOn(queue: string): number[] {
  return [
    ...bossSendDebounced.mock.calls
      .filter(([name]: any[]) => name === queue)
      .map(([, data]: any[]) => data.segmentId as number),
    ...bossInsert.mock.calls
      .filter(([name]: any[]) => name === queue)
      .flatMap(([, jobs]: any[]) => jobs.map((job: any) => job.data.segmentId as number)),
  ];
}

beforeAll(async () => {
  setBossInstance({
    sendDebounced: bossSendDebounced,
    insert: bossInsert,
  } as any);
  core = await seedCoreFixtures();
});

beforeEach(() => {
  bossSendDebounced.mockClear();
  bossInsert.mockClear();
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
  // `save` is declared on BaseEntity, so its static return type is the base class.
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
    storage: SegmentStorage.R2,
    hashedId: `hash-${segmentSeedCounter}`,
    storageBasePath: '/test',
    mediaId,
    episode: episodeNumber,
    ...overrides,
  }) as Promise<Segment>;
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

  it('queues the new line for tokenization', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const episode = fixtures.episodes.pilot;
    await MediaExternalId.save({ mediaId: media.id, source: ExternalSourceType.ANILIST, externalId: '99998' });

    const res = await request(app)
      .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments`)
      .send({
        position: 1,
        startTimeMs: 0,
        endTimeMs: 900,
        textJa: { content: '走る' },
        textEn: { content: 'runs', isMachineTranslated: false },
        textEs: { content: 'corre', isMachineTranslated: false },
        storage: 'R2',
        hashedId: 'single-parse',
      });

    expect(res.status).toBe(201);

    const created = await Segment.findOneByOrFail({ publicId: res.body.publicId });
    expect(enqueuedOn(TOKEN_PARSE_QUEUE)).toContain(created.id);
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

describe('POST /v1/media/:mediaId/episodes/:episodeNumber/segments/batch', () => {
  /** Real One Punch Man lines, as they arrived before the repair. */
  const WAKATI = [
    '残念 だ が 俺 は 命 を かけ てる わけ じゃ ない',
    'この 速さ に つい て こ れる か ?',
    'お前 見 て みろ よ',
    '頼ん で おい た 調査 の ほう は どうなってる ?',
    'ふんっ 深海 王 め 逃げ られ た か',
    'いっぺん 退治 さ れ て 頭 でも 冷や せよ',
    'そこ で 待ってろ え ?',
    '少し は 骨 が あり そう だ な',
    'だが 仕事 は しばらく おあずけ だ ー',
    '災害 レベル の 設定 を 急げ !',
  ];

  const batchOf = (lines: string[]) =>
    lines.map((content, index) => ({
      position: index + 1,
      startTimeMs: index * 1000,
      endTimeMs: index * 1000 + 900,
      textJa: { content },
      textEn: { content: 'en' },
      textEs: { content: 'es' },
      storage: 'R2' as const,
      hashedId: `wakati-${index}`,
    }));

  async function seedIngestTarget() {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    await MediaExternalId.save({ mediaId: media.id, source: ExternalSourceType.ANILIST, externalId: '99997' });
    return { media, episode: fixtures.episodes.pilot };
  }

  it('rejects a morpheme-segmented batch instead of storing it', async () => {
    const { media, episode } = await seedIngestTarget();
    // Enough spaced lines to clear MIN_SPACED_LINES, which is the whole reason
    // this check lives on the batch route and not on the single-segment one.
    const segments = batchOf([...WAKATI, ...WAKATI, ...WAKATI]);

    await assertDifference(
      () => Segment.count(),
      0,
      async () => {
        const res = await request(app)
          .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments/batch`)
          .send({ segments });

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'INVALID_REQUEST' });
        expect(res.body.detail).toMatch(/morpheme-segmented \(wakati-gaki\)/);
      },
    );
  });

  /** Real lines from clean media, including the dash-dialogue shapes that sit
   *  closest to the threshold from above. */
  const CLEAN = [
    'いや 顔 見たら また むかつくかもね',
    'ちゃんと わかってくれたかな',
    'いいだろう とりあえず遊んでやる',
    'その上 封印の書も手の内にあるとなると',
    'どっちが上か 試してやるぜ!',
    'じゃあの わしは また 情報収集に行くからの 。',
    '相変わらず 分かりにくいしゃべりしやがって。この虫オタク!',
    'サスケは絶対 俺が連れて帰る!　一生の約束だってばよ!',
    'まあ そっちは もう少し　太らせてからでもいいだろう。',
    '机で じっとなんか してられっかよ 。なぁ 赤丸',
  ];

  it('accepts a normally spaced batch', async () => {
    const { media, episode } = await seedIngestTarget();
    const segments = batchOf([...CLEAN, ...CLEAN, ...CLEAN]);

    await assertDifference(
      () => Segment.count(),
      +30,
      async () => {
        const res = await request(app)
          .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments/batch`)
          .send({ segments });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ created: 30 });
      },
    );
  });

  it('queues every ingested line for tokenization', async () => {
    // The hole this closes: an upload used to insert its rows, index them, and
    // stop. `Fate/stay night: Unlimited Blade Works` landed on 2026-08-21 with
    // 3,816 sentences and no morphology in either environment, because the only
    // thing that had ever called Shirabe was a script somebody ran by hand.
    const { media, episode } = await seedIngestTarget();

    const res = await request(app)
      .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments/batch`)
      .send({ segments: batchOf(CLEAN) });

    expect(res.status).toBe(201);

    const created = await Segment.find({ where: { mediaId: media.id }, select: { id: true } });
    const byId = (a: number, b: number) => a - b;
    expect([...new Set(enqueuedOn(TOKEN_PARSE_QUEUE))].sort(byId)).toEqual(
      created.map((segment) => segment.id).sort(byId),
    );
  });

  it('accepts a batch too small for the signal to mean anything', async () => {
    const { media, episode } = await seedIngestTarget();

    await assertDifference(
      () => Segment.count(),
      +5,
      async () => {
        const res = await request(app)
          .post(`/v1/media/${media.publicId}/episodes/${episode.episodeNumber}/segments/batch`)
          .send({ segments: batchOf(WAKATI.slice(0, 5)) });

        expect(res.status).toBe(201);
      },
    );
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

  it('includes tokens so the sentence permalink can render the word card', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const tokens = [{ s: 'テスト', d: 'テスト', r: 'テスト', b: 0, e: 3, p: '名詞', kind: 'word' }];
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber, {
      tokens,
    });

    const res = await request(app).get(`/v1/media/segments/${segment.publicId}`);

    expect(res.status).toBe(200);
    expect(res.body.textJa.tokens).toEqual(tokens);
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

  it('drops the analysis and asks for a new one when the Japanese changes', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const episode = fixtures.episodes.pilot;
    // `b`/`e` are offsets into the sentence that was parsed. Leave them in place
    // over an edited line and the reader gets furigana over the wrong kanji,
    // with nothing anywhere saying the analysis no longer fits.
    const segment = await seedSegment(fixtures.media.testShow.id, episode.episodeNumber, {
      contentJa: '走る',
      tokens: [{ s: '走る', d: '走る', r: 'ハシル', b: 0, e: 2, p: '動詞' }],
    });

    const res = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textJa: { content: '歩く' } });

    expect(res.status).toBe(200);

    const updated = await Segment.findOneByOrFail({ id: segment.id });
    expect(updated.contentJa).toBe('歩く');
    expect(updated.tokens).toBeNull();
    expect(enqueuedOn(TOKEN_PARSE_QUEUE)).toContain(segment.id);
  });

  it('keeps the analysis when the edit leaves the Japanese alone', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const episode = fixtures.episodes.pilot;
    const tokens = [{ s: '走る', d: '走る', r: 'ハシル', b: 0, e: 2, p: '動詞' }];
    const segment = await seedSegment(fixtures.media.testShow.id, episode.episodeNumber, {
      contentJa: '走る',
      tokens,
    });

    // Fixing a translation or a timing says nothing about the morphology, and
    // re-parsing on every edit would spend Shirabe's CPU to arrive back here.
    const res = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textEn: { content: 'he walks' }, startTimeMs: 5, endTimeMs: 900 });

    expect(res.status).toBe(200);

    const updated = await Segment.findOneByOrFail({ id: segment.id });
    expect(updated.tokens).toEqual(tokens);
    expect(enqueuedOn(TOKEN_PARSE_QUEUE)).not.toContain(segment.id);
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

  it('has written the revision by the time it responds', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber, {
      contentJa: 'before',
    });

    const res = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textJa: { content: 'after' } });

    expect(res.status).toBe(200);

    // No polling: the revision shares the update's transaction, so a 200 means it
    // is already committed rather than merely scheduled.
    const revisions = await SegmentRevision.find({ where: { segmentId: segment.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revisionNumber: 1,
      userId: core.users.kevin.id,
    });
    expect(revisions[0].snapshot).toMatchObject({ contentJa: 'before' });
  });

  it('numbers successive revisions without gaps or repeats', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber, {
      contentJa: 'first',
    });

    await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textJa: { content: 'second' } });
    await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textJa: { content: 'third' } });

    const revisions = await SegmentRevision.find({
      where: { segmentId: segment.id },
      order: { revisionNumber: 'ASC' },
    });

    expect(revisions.map((r) => r.revisionNumber)).toEqual([1, 2]);
    expect(revisions.map((r) => r.snapshot.contentJa)).toEqual(['first', 'second']);
  });

  it('rolls the segment update back when the revision cannot be written', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const segment = await seedSegment(fixtures.media.testShow.id, fixtures.episodes.pilot.episodeNumber, {
      contentJa: 'original',
    });

    const revisionSpy = vi.spyOn(SegmentRevision, 'create').mockImplementationOnce(() => {
      throw new Error('revision write failed');
    });
    activeSpies.push(revisionSpy);

    const res = await request(app)
      .patch(`/v1/media/segments/${segment.publicId}`)
      .send({ textJa: { content: 'should not stick' } });

    expect(res.status).toBe(500);

    // An edit with no audit trail is worse than a rejected edit, so neither lands.
    const unchanged = await Segment.findOneByOrFail({ id: segment.id });
    expect(unchanged.contentJa).toBe('original');
    expect(await SegmentRevision.countBy({ segmentId: segment.id })).toBe(0);
  });
});

describe('SegmentRevision numbering', () => {
  it('is backed by a unique constraint on (segment_id, revision_number)', async () => {
    // The controller derives the next number under a row lock. True concurrency is
    // not reproducible here, so assert the constraint that makes a collision a
    // failed write rather than two revisions sharing a number.
    const rows = await TestDataSource.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'SegmentRevision' AND indexdef LIKE '%UNIQUE%'
    `);

    expect(rows).toContainEqual(
      expect.objectContaining({ indexdef: expect.stringMatching(/UNIQUE.*\(segment_id, revision_number\)/) }),
    );
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

    const surroundingSpy = vi
      .spyOn(SegmentContext, 'surroundingSegments')
      .mockResolvedValueOnce(contextResponse as any);
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
    const surroundingSpy = vi.spyOn(SegmentContext, 'surroundingSegments').mockResolvedValueOnce({
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
