import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { assertDifference, assertNoDifference, assertChanges } from '../helpers/assertions';
import { Episode } from '@app/models/Episode';

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/media/:mediaId/episodes', () => {
  it('returns episodes for a media', async () => {
    const fixtures = await loadFixtures(['mediaWithTwoEpisodes']);
    const media = fixtures.media.episodicShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      episodes: [{ titleEn: 'First' }, { titleEn: 'Second' }],
      pagination: { hasMore: false, cursor: null },
    });
    expect(res.body.episodes).toHaveLength(2);
  });

  it('returns empty array when media exists but has no episodes', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      episodes: [],
      pagination: { hasMore: false, cursor: null },
    });
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).get('/v1/media/999/episodes');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('paginates with take and cursor', async () => {
    const fixtures = await loadFixtures(['mediaWithThreeEpisodes']);
    const media = fixtures.media.episodicShow;

    const page1 = await request(app).get(`/v1/media/${media.id}/episodes?take=2`);

    expect(page1.status).toBe(200);
    expect(page1.body.episodes).toHaveLength(2);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.pagination.cursor).toEqual(expect.any(String));

    const page2 = await request(app).get(
      `/v1/media/${media.id}/episodes?take=2&cursor=${page1.body.pagination.cursor}`,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.episodes).toHaveLength(1);
    expect(page2.body.pagination).toEqual({ hasMore: false, cursor: null });
  });
});

describe('POST /v1/media/:mediaId/episodes', () => {
  it('creates an episode and returns 201', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    await assertDifference(
      () => Episode.count(),
      +1,
      async () => {
        const res = await request(app)
          .post(`/v1/media/${media.id}/episodes`)
          .send({ episodeNumber: 1, titleEn: 'The Beginning' });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          mediaId: media.id,
          episodeNumber: 1,
          titleEn: 'The Beginning',
        });
      },
    );
  });

  it('persists all optional fields', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).post(`/v1/media/${media.id}/episodes`).send({
      episodeNumber: 5,
      titleEn: 'The Storm',
      titleRomaji: 'Arashi',
      titleJa: '嵐',
      description: 'A big storm approaches',
      lengthSeconds: 1320,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });

    expect(res.status).toBe(201);

    const saved = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 5 });
    expect(saved?.titleRomaji).toBe('Arashi');
    expect(saved?.titleJa).toBe('嵐');
    expect(saved?.description).toBe('A big storm approaches');
    expect(saved?.lengthSeconds).toBe(1320);
    expect(saved?.thumbnailUrl).toBe('https://example.com/thumb.jpg');
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    await assertNoDifference(
      () => Episode.count(),
      async () => {
        const res = await request(app).post('/v1/media/999/episodes').send({ episodeNumber: 1 });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      },
    );
  });

  it('airedAt round-trips correctly', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({ episodeNumber: 1, airedAt: '2024-06-01T00:00:00.000Z' })
      .expect(201);

    expect(res.body).toMatchObject({ airedAt: '2024-06-01T00:00:00.000Z' });

    const getRes = await request(app).get(`/v1/media/${media.id}/episodes/1`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ airedAt: '2024-06-01T00:00:00.000Z' });
  });
});

describe('GET /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('returns the episode', async () => {
    const fixtures = await loadFixtures(['mediaWithThirdEpisode']);
    const media = fixtures.media.testShow;
    const thirdOne = fixtures.episodes.thirdOne;

    const res = await request(app).get(`/v1/media/${media.id}/episodes/${thirdOne.episodeNumber}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mediaId: media.id,
      episodeNumber: 3,
      titleEn: 'Third One',
    });
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).get(`/v1/media/${media.id}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('updates the episode and returns it', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const pilot = fixtures.episodes.pilot;

    await assertChanges(
      async () => (await Episode.findOneByOrFail({ mediaId: media.id, episodeNumber: pilot.episodeNumber })).titleEn,
      { from: 'Pilot', to: 'New Title' },
      async () => {
        const res = await request(app)
          .patch(`/v1/media/${media.id}/episodes/${pilot.episodeNumber}`)
          .send({ titleEn: 'New Title' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ titleEn: 'New Title' });
      },
    );
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).patch(`/v1/media/${media.id}/episodes/999`).send({ titleEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('hard-deletes the episode and returns 204', async () => {
    const fixtures = await loadFixtures(['mediaWithEpisode']);
    const media = fixtures.media.testShow;
    const pilot = fixtures.episodes.pilot;

    await assertDifference(
      () => Episode.count(),
      -1,
      async () => {
        const res = await request(app).delete(`/v1/media/${media.publicId}/episodes/${pilot.episodeNumber}`);
        expect(res.status).toBe(204);
      },
    );

    const deleted = await Episode.findOne({
      where: { mediaId: media.id, episodeNumber: pilot.episodeNumber },
    });
    expect(deleted).toBeNull();
  });

  it('returns 404 when episode does not exist', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/${media.publicId}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
