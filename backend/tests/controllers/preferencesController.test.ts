import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { User } from '@app/models/User';
import { CategoryType } from '@app/models/Media';

setupTestSuite();

const app = createTestApp();
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/user/preferences', () => {
  it('returns current user preferences', async () => {
    fixtures.users.kevin.preferences = {
      searchHistory: { enabled: true },
      hiddenMedia: [{ mediaPublicId: 'untouched-01' }],
    };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app).get('/v1/user/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      searchHistory: { enabled: true },
      hiddenMedia: [{ mediaPublicId: 'untouched-01' }],
    });
  });
});

describe('PATCH /v1/user/preferences', () => {
  it('deep-merges nested objects and preserves unrelated keys', async () => {
    fixtures.users.kevin.preferences = {
      searchHistory: { enabled: true },
      hiddenMedia: [{ mediaPublicId: 'untouched-01' }],
    };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({
        searchHistory: { enabled: false },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      searchHistory: { enabled: false },
      hiddenMedia: [{ mediaPublicId: 'untouched-01' }],
    });

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences).toEqual({
      searchHistory: { enabled: false },
      hiddenMedia: [{ mediaPublicId: 'untouched-01' }],
    });
  });

  it('merges against the stored row, not the cached request user', async () => {
    const kevin = fixtures.users.kevin;
    kevin.preferences = { searchHistory: { enabled: true } };
    await kevin.save();
    signInAs(app, kevin);

    // Another tab writes after this request's user was loaded. The whole column is
    // rewritten on every update, so merging into the stale copy would drop it.
    await User.update(
      { id: kevin.id },
      { preferences: { searchHistory: { enabled: true }, hiddenMedia: [{ mediaPublicId: 'concurrent1' }] } },
    );

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({ searchHistory: { enabled: false } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      searchHistory: { enabled: false },
      hiddenMedia: [{ mediaPublicId: 'concurrent1' }],
    });

    const saved = await User.findOneByOrFail({ id: kevin.id });
    expect(saved.preferences.hiddenMedia).toEqual([{ mediaPublicId: 'concurrent1' }]);
  });

  it('stores hidden categories as long as one stays visible', async () => {
    fixtures.users.kevin.preferences = {};
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({ hiddenCategories: ['JDRAMA', 'YOUTUBE'] });

    expect(res.status).toBe(200);
    expect(res.body.hiddenCategories).toEqual(['JDRAMA', 'YOUTUBE']);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenCategories).toEqual(['JDRAMA', 'YOUTUBE']);
  });

  /**
   * The two settings live on different screens and the hidden list moves under
   * the default, so a stored default that names a hidden category is a state the
   * API has to hold. It is the search that falls back to every category, which
   * keeps the choice for whenever the reader unhides it.
   */
  it('stores a default search category the reader has also hidden', async () => {
    fixtures.users.kevin.preferences = { hiddenCategories: [CategoryType.JDRAMA] };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app).patch('/v1/user/preferences').send({ defaultSearchCategory: 'JDRAMA' });

    expect(res.status).toBe(200);
    expect(res.body.defaultSearchCategory).toBe('JDRAMA');

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.defaultSearchCategory).toBe('JDRAMA');
  });

  it('rejects a default search category outside the enum', async () => {
    fixtures.users.kevin.preferences = {};
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app).patch('/v1/user/preferences').send({ defaultSearchCategory: 'MANGA' });

    expect(res.status).toBe(400);
  });

  /**
   * `filters.category` reads an empty term list as "no filter", so storing an
   * all-hidden list would show the reader the entire corpus rather than nothing.
   */
  it('refuses to hide every category', async () => {
    fixtures.users.kevin.preferences = { hiddenCategories: [CategoryType.YOUTUBE] };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({ hiddenCategories: ['ANIME', 'JDRAMA', 'YOUTUBE'] });

    expect(res.status).toBe(400);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenCategories).toEqual(['YOUTUBE']);
  });

  it('replaces arrays instead of deep-merging them', async () => {
    fixtures.users.kevin.preferences = {
      hiddenMedia: [
        { mediaPublicId: 'old-media-01', nameEn: 'Old One' },
        { mediaPublicId: 'old-media-02', nameEn: 'Old Two' },
      ],
    };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({
        hiddenMedia: [{ mediaPublicId: 'new-media-99', nameEn: 'Only New' }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      hiddenMedia: [{ mediaPublicId: 'new-media-99', nameEn: 'Only New' }],
    });
  });

  it('refuses to store more starred media than the cap allows', async () => {
    // The dedicated endpoint is not the only door into this list: PATCH
    // deep-merges whatever it is handed, so the cap has to be enforced here too
    // or it is bypassable by the client that skips `POST /v1/user/favorite-media`.
    const overCap = Array.from({ length: 101 }, (_, index) => ({
      mediaPublicId: `filler${String(index).padStart(6, '0')}`,
      favoritedAt: new Date().toISOString(),
    }));

    const res = await request(app).patch('/v1/user/preferences').send({ favoriteMedia: overCap });

    expect(res.status).toBe(400);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.favoriteMedia ?? []).toHaveLength(0);
  });

  it('accepts a starred list exactly at the cap', async () => {
    const atCap = Array.from({ length: 100 }, (_, index) => ({
      mediaPublicId: `filler${String(index).padStart(6, '0')}`,
      favoritedAt: new Date().toISOString(),
    }));

    const res = await request(app).patch('/v1/user/preferences').send({ favoriteMedia: atCap });

    expect(res.status).toBe(200);
  });
});
