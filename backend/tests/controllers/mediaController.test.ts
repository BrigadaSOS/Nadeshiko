import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import * as schemas from 'generated/schemas';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { assertDifference } from '../helpers/assertions';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { CategoryType, Media } from '@app/models/Media';
import { MediaExternalId, ExternalSourceType } from '@app/models/MediaExternalId';
import { SegmentStorage } from '@app/models/Segment';

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
const MISSING_MEDIA_PUBLIC_ID = 'MissingMed01';

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

function buildCreateMediaBody(overrides: Record<string, unknown> = {}) {
  return {
    nameJa: '作成テスト',
    nameRomaji: 'Create Test',
    nameEn: 'Create Test',
    airingFormat: 'TV',
    airingStatus: 'FINISHED',
    genres: ['Drama'],
    storage: 'R2',
    startDate: '2024-01-01',
    category: 'ANIME',
    version: '1.0',
    hashSalt: 'hash-salt',
    studio: 'Studio',
    seasonName: 'WINTER',
    seasonYear: 2024,
    storageBasePath: 'media/create-test',
    ...overrides,
  };
}

describe('GET /v1/media', () => {
  it('returns paginated media list', async () => {
    await loadFixtures(['twoMedias']);

    const page1 = await request(app).get('/v1/media?take=1');
    expect(page1.status).toBe(200);
    expect(page1.body.media).toHaveLength(1);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.pagination.cursor).toEqual(expect.any(String));

    const page2 = await request(app).get(`/v1/media?take=1&cursor=${page1.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.media).toHaveLength(1);
    expect(page2.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('filters by query and category', async () => {
    await loadFixtures(['twoMedias']);

    await Media.save({
      publicId: 'DramaTitle01',
      nameJa: 'ドラマ作品',
      nameRomaji: 'Drama Title',
      nameEn: 'Drama Title',
      airingFormat: 'TV',
      airingStatus: 'FINISHED',
      genres: ['Drama'],
      storage: SegmentStorage.R2,
      startDate: '2024-01-01',
      category: CategoryType.JDRAMA,
      version: '1.0',
      hashSalt: 'salt-jdrama',
      studio: 'Drama Studio',
      seasonName: 'SPRING',
      seasonYear: 2024,
      storageBasePath: 'media/drama-title',
    });

    const res = await request(app).get('/v1/media?query=Drama&category=JDRAMA');
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0]).toMatchObject({
      nameEn: 'Drama Title',
      category: 'JDRAMA',
    });
  });
});

describe('POST /v1/search/media', () => {
  it('returns matches and applies category filter', async () => {
    await loadFixtures(['twoMedias']);

    await Media.save({
      publicId: 'DramaStory01',
      nameJa: 'ドラマ',
      nameRomaji: 'Drama Story',
      nameEn: 'Drama Story',
      airingFormat: 'TV',
      airingStatus: 'FINISHED',
      genres: ['Drama'],
      storage: SegmentStorage.R2,
      startDate: '2024-01-01',
      category: CategoryType.JDRAMA,
      version: '1.0',
      hashSalt: 'salt-autocomplete',
      studio: 'Studio',
      seasonName: 'FALL',
      seasonYear: 2024,
      storageBasePath: 'media/drama-story',
    });

    const res = await request(app)
      .post('/v1/search/media')
      .send({
        query: 'story',
        filter: { category: ['JDRAMA'] },
      });
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0]).toMatchObject({
      nameEn: 'Drama Story',
      category: 'JDRAMA',
      mediaPublicId: expect.any(String),
    });
  });

  it('returns 400 when query is only whitespace', async () => {
    const res = await request(app).post('/v1/search/media').send({ query: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/media', () => {
  it('creates media with external ids', async () => {
    let createdPublicId: string | null = null;

    await assertDifference(
      () => Media.count(),
      +1,
      async () => {
        const res = await request(app)
          .post('/v1/media')
          .send(
            buildCreateMediaBody({
              externalIds: {
                anilist: '12345',
                imdb: 'tt12345',
              },
            }),
          );

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          nameEn: 'Create Test',
          externalIds: {
            anilist: '12345',
            imdb: 'tt12345',
          },
        });
        createdPublicId = res.body.mediaPublicId as string;
      },
    );

    const created = await Media.findOneByOrFail({ publicId: createdPublicId as string });
    const rows = await MediaExternalId.findBy({ mediaId: created.id });
    expect(rows).toHaveLength(2);
  });
});

describe('GET /v1/media/:id', () => {
  it('returns media by publicId', async () => {
    const loaded = await loadFixtures(['twoMedias']);
    const media = loaded.media.spyXFamily;

    const res = await request(app).get(`/v1/media/${media.publicId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mediaPublicId: media.publicId,
      nameEn: 'Spy x Family',
    });
    assertMatchesSchema(schemas.s_Media, res.body, 'GET /v1/media/:id 200');
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).get(`/v1/media/${MISSING_MEDIA_PUBLIC_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/:id', () => {
  it('updates fields without resetting storage when omitted', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;
    media.storage = SegmentStorage.LOCAL;
    await media.save();

    const res = await request(app).patch(`/v1/media/${media.publicId}`).send({
      nameEn: 'Updated Name',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nameEn: 'Updated Name' });

    const updated = await Media.findOneByOrFail({ id: media.id });
    expect(updated.storage).toBe(SegmentStorage.LOCAL);
  });

  it('replaces external ids when provided', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    await MediaExternalId.save([
      { mediaId: media.id, source: ExternalSourceType.ANILIST, externalId: 'old-anilist' },
      { mediaId: media.id, source: ExternalSourceType.IMDB, externalId: 'old-imdb' },
    ]);

    const res = await request(app)
      .patch(`/v1/media/${media.publicId}`)
      .send({
        externalIds: {
          tvdb: 'new-tvdb',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.externalIds).toEqual({
      anilist: null,
      imdb: null,
      tmdb: null,
      tvdb: 'new-tvdb',
    });

    const rows = await MediaExternalId.findBy({ mediaId: media.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: ExternalSourceType.TVDB,
      externalId: 'new-tvdb',
    });
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).patch(`/v1/media/${MISSING_MEDIA_PUBLIC_ID}`).send({ nameEn: 'Nope' });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/:id', () => {
  it('hard-deletes media and returns 204', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    await assertDifference(
      () => Media.count(),
      -1,
      async () => {
        const res = await request(app).delete(`/v1/media/${media.publicId}`);
        expect(res.status).toBe(204);
      },
    );

    const deleted = await Media.findOne({ where: { id: media.id } });
    expect(deleted).toBeNull();
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).delete(`/v1/media/${MISSING_MEDIA_PUBLIC_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
