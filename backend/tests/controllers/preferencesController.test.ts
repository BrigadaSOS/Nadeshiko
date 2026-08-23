import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';
import { User } from '@app/models/User';
import { CategoryType } from '@app/models/Media';
import { z } from 'zod/v4';

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
      hiddenMedia: [{ mediaPublicId: 'old-media-01' }, { mediaPublicId: 'old-media-02' }],
    };
    await fixtures.users.kevin.save();
    signInAs(app, fixtures.users.kevin);

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({
        hiddenMedia: [{ mediaPublicId: 'new-media-99' }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      hiddenMedia: [{ mediaPublicId: 'new-media-99' }],
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

/**
 * Rows written before `SlimMediaPreferences1787200000000` hold
 * `{ mediaPublicId, nameEn, ... }` where the slim shape holds an id. The
 * migration rewrote them, but a restore from an older dump has not, and the
 * failure mode is the worst one available: a reader's hidden list resolving to
 * nothing and every title they hid coming back.
 */
describe('preferences written before the media lists were slimmed', () => {
  it('reads the old objects as ids', async () => {
    await User.update(
      { id: fixtures.users.kevin.id },
      {
        preferences: {
          hiddenMedia: [{ mediaPublicId: 'legacy-hid-1', nameEn: 'Old One' }] as never,
          favoriteMedia: [
            { mediaPublicId: 'legacy-fav-1', nameEn: 'Old Two', favoritedAt: '2026-01-02T03:04:05.000Z' },
          ] as never,
        },
      },
    );
    signInAs(app, await User.findOneByOrFail({ id: fixtures.users.kevin.id }));

    const res = await request(app).get('/v1/user/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      hiddenMedia: [{ mediaPublicId: 'legacy-hid-1' }],
      favoriteMedia: [{ mediaPublicId: 'legacy-fav-1', favoritedAt: '2026-01-02T03:04:05.000Z' }],
    });
  });

  it('reads a bare id string, the shape this list is headed for', async () => {
    // Nothing writes this yet. `hiddenMedia` drops the wrapper once no old
    // container or stale tab is left to read it, and accepting it here now is
    // what makes that a backend-only change rather than another migration.
    await User.update({ id: fixtures.users.kevin.id }, { preferences: { hiddenMedia: ['bare-id-01'] as never } });
    signInAs(app, await User.findOneByOrFail({ id: fixtures.users.kevin.id }));

    const res = await request(app).get('/v1/user/preferences');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hiddenMedia: [{ mediaPublicId: 'bare-id-01' }] });
  });

  it('heals the row on the next write, whatever that write was about', async () => {
    await User.update(
      { id: fixtures.users.kevin.id },
      { preferences: { hiddenMedia: [{ mediaPublicId: 'legacy-hid-1', nameEn: 'Old One' }] as never } },
    );
    signInAs(app, await User.findOneByOrFail({ id: fixtures.users.kevin.id }));

    const res = await request(app)
      .patch('/v1/user/preferences')
      .send({ searchHistory: { enabled: false } });

    expect(res.status).toBe(200);

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });
    expect(saved.preferences.hiddenMedia).toEqual([{ mediaPublicId: 'legacy-hid-1' }]);
  });
});

/**
 * Kamal keeps the old containers serving while the new ones come up, so for a
 * window the rows this code writes are being read back by the code it replaced.
 * The entries below are what that old code called valid -- its name fields were
 * optional -- which is the whole reason `hiddenMedia` stayed a wrapper object
 * instead of becoming a bare id string.
 */
describe('what the previous release can still read', () => {
  // A copy of the pre-change schema, on purpose: this is the contract under
  // test, so it has to be spelled out rather than imported from the generated
  // file that has already moved on.
  const previousReleaseSchema = z.object({
    hiddenMedia: z
      .array(
        z.object({
          mediaPublicId: z.string(),
          nameEn: z.string().optional(),
          nameJa: z.string().optional(),
          nameRomaji: z.string().optional(),
        }),
      )
      .optional(),
    favoriteMedia: z
      .array(
        z.object({
          mediaPublicId: z.string(),
          nameEn: z.string().optional(),
          nameJa: z.string().optional(),
          nameRomaji: z.string().optional(),
          favoritedAt: z.iso.datetime({ offset: true }),
        }),
      )
      .optional(),
  });

  it('validates and reads everything this release writes', async () => {
    const loaded = await loadFixtures(['singleMedia']);
    const media = loaded.media.testShow;
    signInAs(app, fixtures.users.kevin);

    await request(app).post('/v1/user/excluded-media').send({ mediaPublicId: media.publicId });
    await request(app).post('/v1/user/favorite-media').send({ mediaPublicId: media.publicId });

    const saved = await User.findOneByOrFail({ id: fixtures.users.kevin.id });

    // Would throw where the old container's response validation would 500.
    const parsed = previousReleaseSchema.parse(saved.preferences);

    // And `item.mediaPublicId`, which is how all of the old code reaches in,
    // still answers -- a bare string would have read as `undefined` and emptied
    // the reader's hidden list mid-deploy.
    expect(parsed.hiddenMedia?.map((item) => item.mediaPublicId)).toEqual([media.publicId]);
    expect(parsed.favoriteMedia?.map((item) => item.mediaPublicId)).toEqual([media.publicId]);
  });
});
