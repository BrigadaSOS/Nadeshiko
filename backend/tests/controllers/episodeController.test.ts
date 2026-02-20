import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { TestDataSource, createTestApp, signInAs, truncateTables } from '../helpers/setup';
import { seedTestUser } from '../fixtures/users';
import { seedMedia, seedEpisode } from '../fixtures/media';
import { User } from '@app/models/User';
import { Episode } from '@app/models/Episode';

const app = createTestApp();

let testUser: User;

beforeAll(async () => {
  await TestDataSource.initialize();
});

afterAll(async () => {
  await TestDataSource.destroy();
});

beforeEach(async () => {
  await truncateTables('Episode', 'Media', 'User');
  testUser = await seedTestUser();
  signInAs(app, testUser);
});

describe('GET /v1/media/:mediaId/episodes', () => {
  it('returns episodes for a media', async () => {
    const media = await seedMedia();
    await seedEpisode(media.id, { episodeNumber: 1, titleEn: 'First' });
    await seedEpisode(media.id, { episodeNumber: 2, titleEn: 'Second' });

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body.episodes).toHaveLength(2);
    expect(res.body.episodes[0].titleEn).toBe('First');
    expect(res.body.episodes[1].titleEn).toBe('Second');
    expect(res.body.pagination).toEqual({ hasMore: false, cursor: null });
  });

  it('returns empty array when media exists but has no episodes', async () => {
    const media = await seedMedia();

    const res = await request(app).get(`/v1/media/${media.id}/episodes`);

    expect(res.status).toBe(200);
    expect(res.body.episodes).toEqual([]);
  });

  it('returns 404 when media does not exist', async () => {
    const res = await request(app).get('/v1/media/999/episodes');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('paginates with limit and cursor', async () => {
    const media = await seedMedia();
    await seedEpisode(media.id, { episodeNumber: 1 });
    await seedEpisode(media.id, { episodeNumber: 2 });
    await seedEpisode(media.id, { episodeNumber: 3 });

    const res = await request(app).get(`/v1/media/${media.id}/episodes?limit=2&cursor=0`);

    expect(res.status).toBe(200);
    expect(res.body.episodes).toHaveLength(2);
    expect(res.body.pagination.hasMore).toBe(true);
    expect(res.body.pagination.cursor).toBe(2);
  });
});

describe('POST /v1/media/:mediaId/episodes', () => {
  it('creates an episode and returns 201', async () => {
    const media = await seedMedia();

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({ episodeNumber: 1, titleEn: 'The Beginning' });

    expect(res.status).toBe(201);
    expect(res.body.mediaId).toBe(media.id);
    expect(res.body.episodeNumber).toBe(1);
    expect(res.body.titleEn).toBe('The Beginning');

    // Verify it's actually in the database
    const saved = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 1 });
    expect(saved).not.toBeNull();
    expect(saved!.titleEn).toBe('The Beginning');
  });

  it('persists all optional fields', async () => {
    const media = await seedMedia();

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({
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
    expect(saved!.titleRomaji).toBe('Arashi');
    expect(saved!.titleJa).toBe('嵐');
    expect(saved!.description).toBe('A big storm approaches');
    expect(saved!.lengthSeconds).toBe(1320);
    expect(saved!.thumbnailUrl).toBe('https://example.com/thumb.jpg');
  });

  it('returns 404 when media does not exist (FK violation)', async () => {
    const res = await request(app).post('/v1/media/999/episodes').send({ episodeNumber: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('airedAt round-trips correctly', async () => {
    const media = await seedMedia();

    const res = await request(app)
      .post(`/v1/media/${media.id}/episodes`)
      .send({ episodeNumber: 1, airedAt: '2024-06-01T00:00:00.000Z' })
      .expect(201);

    expect(res.body.airedAt).toBe('2024-06-01T00:00:00.000Z');

    // Verify GET also returns it correctly (read back from DB as Date)
    const getRes = await request(app).get(`/v1/media/${media.id}/episodes/1`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.airedAt).toBe('2024-06-01T00:00:00.000Z');
  });
});

describe('GET /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('returns the episode', async () => {
    const media = await seedMedia();
    await seedEpisode(media.id, { episodeNumber: 3, titleEn: 'Third One' });

    const res = await request(app).get(`/v1/media/${media.id}/episodes/3`);

    expect(res.status).toBe(200);
    expect(res.body.mediaId).toBe(media.id);
    expect(res.body.episodeNumber).toBe(3);
    expect(res.body.titleEn).toBe('Third One');
  });

  it('returns 404 when episode does not exist', async () => {
    const media = await seedMedia();

    const res = await request(app).get(`/v1/media/${media.id}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('PATCH /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('updates the episode and returns it', async () => {
    const media = await seedMedia();
    await seedEpisode(media.id, { episodeNumber: 1, titleEn: 'Old Title' });

    const res = await request(app)
      .patch(`/v1/media/${media.id}/episodes/1`)
      .send({ titleEn: 'New Title' });

    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe('New Title');

    // Verify the database was updated
    const updated = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 1 });
    expect(updated!.titleEn).toBe('New Title');
  });

  it('returns 404 when episode does not exist', async () => {
    const media = await seedMedia();

    const res = await request(app)
      .patch(`/v1/media/${media.id}/episodes/999`)
      .send({ titleEn: 'Nope' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /v1/media/:mediaId/episodes/:episodeNumber', () => {
  it('soft-deletes the episode and returns 204', async () => {
    const media = await seedMedia();
    await seedEpisode(media.id, { episodeNumber: 1 });

    const res = await request(app).delete(`/v1/media/${media.id}/episodes/1`);

    expect(res.status).toBe(204);

    // Verify it's soft-deleted (not returned by default queries)
    const found = await Episode.findOneBy({ mediaId: media.id, episodeNumber: 1 });
    expect(found).toBeNull();

    // But still exists with withDeleted
    const withDeleted = await Episode.findOne({
      where: { mediaId: media.id, episodeNumber: 1 },
      withDeleted: true,
    });
    expect(withDeleted).not.toBeNull();
    expect(withDeleted!.deletedAt).not.toBeNull();
  });

  it('returns 404 when episode does not exist', async () => {
    const media = await seedMedia();

    const res = await request(app).delete(`/v1/media/${media.id}/episodes/999`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
