import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { TestDataSource, createTestApp, signInAs, truncateTables } from '../helpers/setup';
import { seedTestUser } from '../fixtures/users';
import { seedMedia } from '../fixtures/media';
import { User } from '@app/models/User';
import { Series } from '@app/models/Series';
import { SeriesMedia } from '@app/models/SeriesMedia';

const app = createTestApp();

let testUser: User;

const seedSeries = async (overrides: Record<string, unknown> = {}) =>
  Series.save({
    nameJa: 'シリーズ',
    nameRomaji: 'Shirizu',
    nameEn: 'Test Series',
    ...overrides,
  });

beforeAll(async () => {
  await TestDataSource.initialize();
});

afterAll(async () => {
  if (TestDataSource.isInitialized) {
    await TestDataSource.destroy();
  }
});

beforeEach(async () => {
  await truncateTables('SeriesMedia', 'Series', 'Episode', 'Media', 'User');
  testUser = await seedTestUser();
  signInAs(app, testUser);
});

describe('GET /v1/media/series', () => {
  it('returns paginated series sorted by name', async () => {
    await seedSeries({ nameEn: 'B Series', nameRomaji: 'B', nameJa: 'B' });
    await seedSeries({ nameEn: 'A Series', nameRomaji: 'A', nameJa: 'A' });

    const res = await request(app).get('/v1/media/series');

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.series[0].nameEn).toBe('A Series');
    expect(res.body.series[1].nameEn).toBe('B Series');
    expect(res.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('filters by query string', async () => {
    await seedSeries({ nameEn: 'Naruto', nameRomaji: 'Naruto', nameJa: 'ナルト' });
    await seedSeries({ nameEn: 'Bleach', nameRomaji: 'Bleach', nameJa: 'ブリーチ' });

    const res = await request(app).get('/v1/media/series?query=naru');

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(1);
    expect(res.body.series[0].nameEn).toBe('Naruto');
  });

  it('supports cursor pagination', async () => {
    await seedSeries({ nameEn: 'A', nameRomaji: 'A', nameJa: 'A' });
    await seedSeries({ nameEn: 'B', nameRomaji: 'B', nameJa: 'B' });
    await seedSeries({ nameEn: 'C', nameRomaji: 'C', nameJa: 'C' });

    const res = await request(app).get('/v1/media/series?limit=2&cursor=0');

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(2);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.cursor).toBe(2);
  });
});

describe('GET /v1/media/series/:id', () => {
  it('returns series with media ordered by position', async () => {
    const series = await seedSeries();
    const mediaA = await seedMedia({ nameEn: 'Media A', nameRomaji: 'Media A', nameJa: 'Media A' });
    const mediaB = await seedMedia({ nameEn: 'Media B', nameRomaji: 'Media B', nameJa: 'Media B' });

    await SeriesMedia.save({ seriesId: series.id, mediaId: mediaA.id, position: 2 });
    await SeriesMedia.save({ seriesId: series.id, mediaId: mediaB.id, position: 1 });

    const res = await request(app).get(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(series.id);
    expect(res.body.media).toHaveLength(2);
    expect(res.body.media[0].position).toBe(1);
    expect(res.body.media[0].media.id).toBe(mediaB.id);
    expect(res.body.media[1].position).toBe(2);
    expect(res.body.media[1].media.id).toBe(mediaA.id);
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).get('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
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
    expect(res.body.nameEn).toBe('Attack on Titan');

    const saved = await Series.findOneBy({ id: res.body.id });
    expect(saved).not.toBeNull();
    expect(saved!.nameRomaji).toBe('Shingeki no Kyojin');
  });
});

describe('PATCH /v1/media/series/:id', () => {
  it('updates a series and returns it', async () => {
    const series = await seedSeries({ nameEn: 'Old Name' });

    const res = await request(app).patch(`/v1/media/series/${series.id}`).send({ nameEn: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.nameEn).toBe('New Name');

    const updated = await Series.findOneBy({ id: series.id });
    expect(updated!.nameEn).toBe('New Name');
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).patch('/v1/media/series/999').send({ nameEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /v1/media/series/:id', () => {
  it('deletes the series and returns 204', async () => {
    const series = await seedSeries();

    const res = await request(app).delete(`/v1/media/series/${series.id}`);

    expect(res.status).toBe(204);
    const deleted = await Series.findOneBy({ id: series.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when series does not exist', async () => {
    const res = await request(app).delete('/v1/media/series/999');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('POST /v1/media/series/:id/media', () => {
  it('adds media to series', async () => {
    const series = await seedSeries();
    const media = await seedMedia();

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(204);

    const entry = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(entry).not.toBeNull();
    expect(entry!.position).toBe(1);
  });

  it('returns 404 when series does not exist (FK violation)', async () => {
    const media = await seedMedia();

    const res = await request(app).post('/v1/media/series/999/media').send({
      mediaId: media.id,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    const series = await seedSeries();

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: 999,
      position: 1,
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 409 when adding duplicate media entry', async () => {
    const series = await seedSeries();
    const media = await seedMedia();
    await SeriesMedia.save({ seriesId: series.id, mediaId: media.id, position: 1 });

    const res = await request(app).post(`/v1/media/series/${series.id}/media`).send({
      mediaId: media.id,
      position: 2,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });
});

describe('PATCH /v1/media/series/:id/media/:mediaId', () => {
  it('updates media position in series', async () => {
    const series = await seedSeries();
    const media = await seedMedia();
    await SeriesMedia.save({ seriesId: series.id, mediaId: media.id, position: 1 });

    const res = await request(app).patch(`/v1/media/series/${series.id}/media/${media.id}`).send({ position: 3 });

    expect(res.status).toBe(204);

    const updated = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(updated!.position).toBe(3);
  });

  it('returns 404 when relation does not exist', async () => {
    const series = await seedSeries();
    const media = await seedMedia();

    const res = await request(app).patch(`/v1/media/series/${series.id}/media/${media.id}`).send({ position: 2 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /v1/media/series/:id/media/:mediaId', () => {
  it('removes media from series', async () => {
    const series = await seedSeries();
    const media = await seedMedia();
    await SeriesMedia.save({ seriesId: series.id, mediaId: media.id, position: 1 });

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(204);

    const deleted = await SeriesMedia.findOneBy({ seriesId: series.id, mediaId: media.id });
    expect(deleted).toBeNull();
  });

  it('returns 404 when relation does not exist', async () => {
    const series = await seedSeries();
    const media = await seedMedia();

    const res = await request(app).delete(`/v1/media/series/${series.id}/media/${media.id}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
