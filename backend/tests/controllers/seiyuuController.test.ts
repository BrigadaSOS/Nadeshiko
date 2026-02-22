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

describe('GET /v1/media/seiyuu/:id', () => {
  it('returns seiyuu with flattened character media roles', async () => {
    const fixtures = await loadFixtures(['seiyuuWithRoles']);
    const saori = fixtures.seiyuu.saori;
    const yor = fixtures.characters.yor;
    const spyXFamily = fixtures.media.spyXFamily;
    const anotherShow = fixtures.media.anotherShow;

    const res = await request(app).get(`/v1/media/seiyuu/${saori.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: saori.id,
      nameJa: '早見沙織',
      nameEn: 'Saori Hayami',
    });
    expect(res.body.characters).toEqualUnordered([
      expect.objectContaining({
        id: yor.id,
        nameJa: 'ヨル',
        nameEn: 'Yor',
        role: 'MAIN',
        media: expect.objectContaining({ id: spyXFamily.id }),
      }),
      expect.objectContaining({
        id: yor.id,
        nameJa: 'ヨル',
        nameEn: 'Yor',
        role: 'SUPPORTING',
        media: expect.objectContaining({ id: anotherShow.id }),
      }),
    ]);
  });

  it('returns empty characters when seiyuu has no characters', async () => {
    const fixtures = await loadFixtures(['seiyuuNoCharacters']);
    const kana = fixtures.seiyuu.kana;

    const res = await request(app).get(`/v1/media/seiyuu/${kana.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: kana.id,
      nameJa: '花澤香菜',
      nameEn: 'Kana Hanazawa',
      characters: [],
    });
  });

  it('returns 404 when seiyuu does not exist', async () => {
    const res = await request(app).get('/v1/media/seiyuu/999');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
