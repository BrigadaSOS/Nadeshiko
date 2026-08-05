import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { User } from '@app/models/User';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;
const MISSING_MEDIA_PUBLIC_ID = 'MissingMed01';

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

beforeEach(async () => {
  fixtures.users.kevin.preferences = {};
  await fixtures.users.kevin.save();
  signInAs(app, fixtures.users.kevin);
});

describe('POST /v1/user/excluded-media', () => {
  it('adds the media to the hidden list', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    const res = await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });

    expect(res.status).toBe(204);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia).toEqual([
      expect.objectContaining({ mediaPublicId: media.publicId, nameEn: media.nameEn }),
    ]);
  });

  it('is a no-op when the media is already hidden', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });
    const res = await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });

    expect(res.status).toBe(204);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia).toHaveLength(1);
  });

  it('keeps a concurrent write that the cached request user does not know about', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    // Another tab hides something else after this request's user was loaded.
    // The whole preferences column is rewritten, so building the new value from
    // the stale copy would silently drop that entry.
    await User.update(
      { id: fixtures.users.kevin.id },
      { preferences: { hiddenMedia: [{ mediaPublicId: 'concurrent1' }] } },
    );

    const res = await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });

    expect(res.status).toBe(204);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia?.map((item) => item.mediaPublicId)).toEqual(['concurrent1', media.publicId]);
  });

  it('returns 404 when the media does not exist', async () => {
    const res = await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: MISSING_MEDIA_PUBLIC_ID });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('DELETE /v1/user/excluded-media/:mediaPublicId', () => {
  it('removes the media from the hidden list', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;
    await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });

    const res = await request(app).delete(`/v1/user/excluded-media/${media.publicId}`);

    expect(res.status).toBe(204);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia).toEqual([]);
  });

  it('keeps a concurrent write that the cached request user does not know about', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;

    await User.update(
      { id: fixtures.users.kevin.id },
      { preferences: { hiddenMedia: [{ mediaPublicId: media.publicId }, { mediaPublicId: 'concurrent1' }] } },
    );

    const res = await request(app).delete(`/v1/user/excluded-media/${media.publicId}`);

    expect(res.status).toBe(204);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia?.map((item) => item.mediaPublicId)).toEqual(['concurrent1']);
  });

  it('returns 404 when the media is not hidden', async () => {
    const res = await request(app).delete(`/v1/user/excluded-media/${MISSING_MEDIA_PUBLIC_ID}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leaves the stored preferences untouched when it 404s', async () => {
    await User.update(
      { id: fixtures.users.kevin.id },
      { preferences: { hiddenMedia: [{ mediaPublicId: 'concurrent1' }] } },
    );

    const res = await request(app).delete(`/v1/user/excluded-media/${MISSING_MEDIA_PUBLIC_ID}`);

    expect(res.status).toBe(404);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia).toEqual([{ mediaPublicId: 'concurrent1' }]);
  });
});

describe('GET /v1/user/excluded-media', () => {
  it('resolves hidden entries to media summaries', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;
    await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });

    const res = await request(app).get('/v1/user/excluded-media');

    expect(res.status).toBe(200);
    expect(res.body.excludedMedia).toHaveLength(1);
    expect(res.body.excludedMedia[0]).toMatchObject({ publicId: media.publicId });
  });
});
