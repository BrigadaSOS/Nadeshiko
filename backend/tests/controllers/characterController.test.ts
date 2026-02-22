import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from 'bun:test';
import { setupTestSuite, createTestApp, signInAs } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { loadFixtures } from '../fixtures/loader';


setupTestSuite();

const app = createTestApp();

let fixtures: CoreFixtures;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});
beforeEach(() => {
  signInAs(app, fixtures.users.kevin);
});

describe('GET /v1/media/characters/:id', () => {
  it('returns character with seiyuu and media appearances', async () => {
    const fixtures = await loadFixtures(['seiyuuWithRoles']);
    const yor = fixtures.characters.yor;
    const saori = fixtures.seiyuu.saori;
    const spyXFamily = fixtures.media.spyXFamily;
    const anotherShow = fixtures.media.anotherShow;

    const res = await request(app).get(`/v1/media/characters/${yor.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: yor.id,
      nameJa: 'ヨル',
      nameEn: 'Yor',
      seiyuu: expect.objectContaining({
        id: saori.id,
        nameJa: '早見沙織',
        nameEn: 'Saori Hayami',
      }),
    });
    expect(res.body.mediaAppearances).toEqualUnordered([
      expect.objectContaining({
        role: 'MAIN',
        media: expect.objectContaining({ id: spyXFamily.id }),
      }),
      expect.objectContaining({
        role: 'SUPPORTING',
        media: expect.objectContaining({ id: anotherShow.id }),
      }),
    ]);
  });

  it('returns empty mediaAppearances when character has none', async () => {
    const fixtures = await loadFixtures(['characterNoAppearances']);
    const alice = fixtures.characters.alice;

    const res = await request(app).get(`/v1/media/characters/${alice.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: alice.id,
      nameJa: 'アリス',
      nameEn: 'Alice',
      mediaAppearances: [],
    });
  });

  it('returns 404 when character does not exist', async () => {
    const res = await request(app).get('/v1/media/characters/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
