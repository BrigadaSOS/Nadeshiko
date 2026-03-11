import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import * as schemas from 'generated/schemas';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { assertDifference } from '../helpers/assertions';
import { assertMatchesSchema } from '../helpers/openapiContract';
import { CategoryType, Media } from '@app/models/Media';
import { CharacterRole, MediaCharacter } from '@app/models/MediaCharacter';
import { MediaExternalId, ExternalSourceType } from '@app/models/MediaExternalId';
import { SegmentStorage } from '@app/models/Segment';
import { Character } from '@app/models/Character';
import { Seiyuu } from '@app/models/Seiyuu';

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;

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
    await loadFixtures(['seiyuuWithRoles']);

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
    await loadFixtures(['seiyuuWithRoles']);

    await Media.save({
      publicId: 'pub-drama-title',
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

describe('GET /v1/media/autocomplete', () => {
  it('returns matches and applies category filter', async () => {
    await loadFixtures(['seiyuuWithRoles']);

    await Media.save({
      publicId: 'pub-drama-story',
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

    const res = await request(app).get('/v1/media/autocomplete?query=story&category=JDRAMA');
    expect(res.status).toBe(200);
    expect(res.body.media).toHaveLength(1);
    expect(res.body.media[0]).toMatchObject({
      nameEn: 'Drama Story',
      category: 'JDRAMA',
    });
  });

  it('returns 400 when query is only whitespace', async () => {
    const res = await request(app).get('/v1/media/autocomplete?query=%20%20%20');
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/media', () => {
  it('creates media with external ids', async () => {
    let createdId: number | null = null;

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
        createdId = res.body.id as number;
      },
    );

    const rows = await MediaExternalId.findBy({ mediaId: createdId as number });
    expect(rows).toHaveLength(2);
  });

  it('creates media with nested character and seiyuu payload', async () => {
    const res = await request(app)
      .post('/v1/media')
      .send(
        buildCreateMediaBody({
          nameEn: 'Media With Characters',
          storageBasePath: 'media/with-characters',
          characters: [
            {
              externalIds: { anilist: 'c-100' },
              nameJa: 'キャラ',
              nameEn: 'Character',
              imageUrl: 'https://example.com/char.jpg',
              role: 'MAIN',
              seiyuu: {
                externalIds: { anilist: 's-100' },
                nameJa: '声優',
                nameEn: 'Seiyuu',
                imageUrl: 'https://example.com/seiyuu.jpg',
              },
            },
          ],
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body.characters).toHaveLength(1);
    expect(res.body.characters[0]).toMatchObject({
      nameEn: 'Character',
      role: CharacterRole.MAIN,
      seiyuu: { nameEn: 'Seiyuu' },
    });

    const mediaId = res.body.id as number;
    expect(await MediaCharacter.countBy({ mediaId })).toBe(1);
    expect(await Character.count()).toBeGreaterThanOrEqual(1);
    expect(await Seiyuu.count()).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /v1/media/:id', () => {
  it('returns media and includes characters when requested', async () => {
    const loaded = await loadFixtures(['seiyuuWithRoles']);
    const media = loaded.media.spyXFamily;

    const res = await request(app).get(`/v1/media/${media.id}?include=media.characters`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: media.id,
      nameEn: 'Spy x Family',
    });
    expect(res.body.characters).toHaveLength(1);
    assertMatchesSchema(schemas.s_Media, res.body, 'GET /v1/media/:id 200');
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).get('/v1/media/999999');
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

    const res = await request(app).patch(`/v1/media/${media.id}`).send({
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
      .patch(`/v1/media/${media.id}`)
      .send({
        externalIds: {
          tvdb: 'new-tvdb',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.externalIds).toEqual({ tvdb: 'new-tvdb' });

    const rows = await MediaExternalId.findBy({ mediaId: media.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: ExternalSourceType.TVDB,
      externalId: 'new-tvdb',
    });
  });

  it('clears media characters when an empty list is provided', async () => {
    const createRes = await request(app)
      .post('/v1/media')
      .send(
        buildCreateMediaBody({
          nameEn: 'To Clear Characters',
          storageBasePath: 'media/to-clear',
          characters: [
            {
              externalIds: { anilist: 'c-clear' },
              nameJa: 'クリア',
              nameEn: 'Clear',
              imageUrl: 'https://example.com/clear-char.jpg',
              role: 'SUPPORTING',
              seiyuu: {
                externalIds: { anilist: 's-clear' },
                nameJa: 'クリア声優',
                nameEn: 'Clear Seiyuu',
                imageUrl: 'https://example.com/clear-seiyuu.jpg',
              },
            },
          ],
        }),
      );
    expect(createRes.status).toBe(201);
    const mediaId = createRes.body.id as number;
    expect(await MediaCharacter.countBy({ mediaId })).toBe(1);

    const res = await request(app).patch(`/v1/media/${mediaId}`).send({
      characters: [],
    });

    expect(res.status).toBe(200);
    expect(res.body.characters).toEqual([]);
    expect(await MediaCharacter.countBy({ mediaId })).toBe(0);
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).patch('/v1/media/999999').send({ nameEn: 'Nope' });
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
    const res = await request(app).delete('/v1/media/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
