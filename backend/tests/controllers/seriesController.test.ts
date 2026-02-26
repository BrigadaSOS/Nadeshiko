import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { Series } from '@app/models/Series';
import { SeriesMedia } from '@app/models/SeriesMedia';

setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/media/series', () => {
  it('returns paginated series sorted by name', async () => {
    await loadFixtures(['twoSeriesAlphabetical']);

    const res = await request(app).get('/v1/media/series');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      series: [{ nameEn: 'A Series' }, { nameEn: 'B Series' }],
      pagination: { hasMore: false, cursor: null },
    });
    expect(res.body.series).toHaveLength(2);
  });

  it('filters by query string', async () => {
    await loadFixtures(['twoSeriesForSearch']);

    const res = await request(app).get('/v1/media/series?query=naru');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      series: [{ nameEn: 'Naruto' }],
    });
    expect(res.body.series).toHaveLength(1);
  });

  it('supports cursor pagination', async () => {
    await loadFixtures(['threeSeriesForPagination']);

    const page1 = await request(app).get('/v1/media/series?take=2');

    expect(page1.status).toBe(200);
    expect(page1.body.series).toHaveLength(2);
    expect(page1.body.pagination.hasMore).toBe(true);
    expect(page1.body.pagination.cursor).toEqual(expect.any(String));

    const page2 = await request(app).get(`/v1/media/series?take=2&cursor=${page1.body.pagination.cursor}`);
    expect(page2.status).toBe(200);
    expect(page2.body.series).toHaveLength(1);
    expect(page2.body.pagination).toEqual({ hasMore: false, cursor: null });
  });
});

describe('GET /v1/media/series/:id', () => {
  it('returns series with media ordered by position', async () => {
    const fixtures = await loadFixtures(['seriesWithOrderedMedia']);
    const series = fixtures.series.testSeries;
    const mediaA = fixtures.media.mediaA;
    const mediaB = fixtures.media.mediaB;

    const res = await request(app).get(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: series.id,
      media: [
        { position: 1, media: { id: mediaB.id } },
        { position: 2, media: { id: mediaA.id } },
      ],
    });
    expect(res.body.media).toHaveLength(2);
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).get('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /v1/media/series', () => {
  it('creates a series and returns 201', async () => {
    const res = await request(app).post('/v1/media/series').send({
      nameJa: '進撃の巨人',
      nameRomaji: 'Shingeki no Kyojin',
      nameEn: 'Attack on Titan',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nameEn: 'Attack on Titan' });

    const saved = await Series.findOneBy({ id: res.body.id });
    expect(saved).not.toBeNull();
    expect(saved?.nameRomaji).toBe('Shingeki no Kyojin');
  });
});

describe('PATCH /v1/media/series/:id', () => {
  it('updates a series and returns it', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).patch(`/v1/media/series/${series.id}`).send({ nameEn: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ nameEn: 'New Name' });

    const updated = await Series.findOneBy({ id: series.id });
    expect(updated?.nameEn).toBe('New Name');
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).patch('/v1/media/series/999').send({ nameEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/series/:id', () => {
  it('deletes the series and returns 204', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).delete(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(204);

    const deleted = await Series.findOneBy({ id: series.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).delete('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /v1/media/series/:id/media', () => {
  it('adds media to series', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(204);

    const entry = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(entry).not.toBeNull();
    expect(entry?.position).toBe(1);
  });

  it('returns 404 when series does not exist (FK violation)', async () => {
    const fixtures = await loadFixtures(['singleMedia']);
    const media = fixtures.media.testShow;

    const res = await request(app).post('/v1/media/series/999/media').send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    const fixtures = await loadFixtures(['singleSeries']);
    const series = fixtures.series.testSeries;

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: 999,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('PATCH /v1/media/series/:id/media/:mediaId', () => {
  it('updates media position in series', async () => {
    const fixtures = await loadFixtures(['seriesWithLinkedMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).patch(`/v1/media/series/${series.id}/media/${media.id}`).send({ position: 3 });

    expect(res.status).toBe(204);

    const updated = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(updated?.position).toBe(3);
  });

  it('returns 404 when relation does not exist', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).patch(`/v1/media/series/${series.id}/media/${media.id}`).send({ position: 2 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/media/series/:id/media/:mediaId', () => {
  it('removes media from series', async () => {
    const fixtures = await loadFixtures(['seriesWithLinkedMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(204);

    const deleted = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when relation does not exist', async () => {
    const fixtures = await loadFixtures(['seriesAndMedia']);
    const series = fixtures.series.testSeries;
    const media = fixtures.media.testShow;

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
