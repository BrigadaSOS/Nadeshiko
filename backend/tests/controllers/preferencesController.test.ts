import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { User } from '@app/models/User';

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
});
