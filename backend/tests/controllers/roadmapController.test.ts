import type { Application, NextFunction, Request, Response } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoadmapItem, RoadmapItemKind, RoadmapItemStatus } from '@app/models';
import { ApiKeyKind, ApiPermission, AuthType } from '@app/models/ApiPermission';
import { buildApplication } from '@config/application';
import { AdminRoutes, RoadmapRoutes } from '@config/routes';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { request } from '../helpers/http';
import { setupTestSuite } from '../helpers/setup';

setupTestSuite();

let app: Application;
let core: CoreFixtures;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.API_KEY,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', RoadmapRoutes);
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.kevin;
  vi.restoreAllMocks();
  await RoadmapItem.query('DELETE FROM "RoadmapItem"');
});

describe('GET /v1/roadmap', () => {
  it('returns only public stages and keeps private requester ids private', async () => {
    await RoadmapItem.save([
      RoadmapItem.create({
        kind: RoadmapItemKind.FEATURE,
        status: RoadmapItemStatus.CONSIDERING,
        title: 'Visible feature',
        description: '',
        sortOrder: 2,
        requesterUserId: core.users.regular.id,
      }),
      RoadmapItem.create({
        kind: RoadmapItemKind.CONTENT,
        status: RoadmapItemStatus.PROPOSED,
        title: 'Private proposal',
        description: '',
        sortOrder: 1,
      }),
      RoadmapItem.create({
        kind: RoadmapItemKind.FEATURE,
        status: RoadmapItemStatus.PLANNED,
        title: 'Patreon title proposals',
        description: '',
        sortOrder: 0,
      }),
    ]);

    const res = await request(app).get('/v1/roadmap');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ title: 'Visible feature', status: 'CONSIDERING' });
    expect(res.body.items[0]).not.toHaveProperty('requesterUserId');
    expect(res.body.patreonUrl).toMatch(/^https:\/\//);
  });
});

describe('the admin roadmap', () => {
  it('creates a minimal feature with stable defaults', async () => {
    const res = await request(app)
      .post('/v1/admin/roadmap')
      .send({ kind: 'FEATURE', status: 'PLANNED', title: 'Keyboard shortcuts' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'FEATURE',
      status: 'PLANNED',
      title: 'Keyboard shortcuts',
      description: '',
      sourceUrl: null,
      coverUrl: null,
      introducedInVersion: null,
      sortOrder: 0,
      requesterUserId: null,
    });
  });

  it('uses AniList metadata when an admin adds content without a cover', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Media: {
              title: { english: 'Frieren', romaji: 'Sousou no Frieren' },
              coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/x.jpg' },
              siteUrl: 'https://anilist.co/anime/154587',
            },
          },
        }),
        { status: 200 },
      ),
    );

    const res = await request(app).post('/v1/admin/roadmap').send({
      kind: 'CONTENT',
      status: 'IN_PROGRESS',
      title: 'Frieren',
      sourceUrl: 'https://anilist.co/anime/154587',
      description: 'In progress',
      targetDate: '2026-10-01',
      introducedInVersion: '2.5.0',
      sortOrder: 4,
      proposerName: 'Nadeshiko patrons',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/x.jpg',
      targetDate: '2026-10-01',
      introducedInVersion: '2.5.0',
      sortOrder: 4,
    });
  });

  it('updates only supplied fields and returns private data to admins', async () => {
    const item = await RoadmapItem.save(
      RoadmapItem.create({
        kind: RoadmapItemKind.FEATURE,
        status: RoadmapItemStatus.CONSIDERING,
        title: 'Old title',
        description: 'Keep me',
        sortOrder: 3,
        requesterUserId: core.users.regular.id,
      }),
    );

    const patched = await request(app).patch(`/v1/admin/roadmap/${item.publicId}`).send({ title: 'New title' });
    const listed = await request(app).get('/v1/admin/roadmap');

    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ title: 'New title', description: 'Keep me', sortOrder: 3 });
    expect(listed.body.items[0]).toMatchObject({ id: item.publicId, requesterUserId: core.users.regular.id });
  });

  it('updates every editable field and rejects an unknown item', async () => {
    const item = await RoadmapItem.save(
      RoadmapItem.create({
        kind: RoadmapItemKind.FEATURE,
        status: RoadmapItemStatus.CONSIDERING,
        title: 'Draft',
        description: '',
        sortOrder: 0,
      }),
    );

    const res = await request(app).patch(`/v1/admin/roadmap/${item.publicId}`).send({
      kind: 'CONTENT',
      status: 'RELEASED',
      title: 'Released title',
      description: 'Done',
      sourceUrl: 'https://anilist.co/anime/1',
      coverUrl: 'https://example.com/cover.jpg',
      proposerName: null,
      targetDate: null,
      introducedInVersion: '2.4.19',
      sortOrder: 9,
    });
    const missing = await request(app)
      .patch('/v1/admin/roadmap/00000000-0000-4000-8000-000000000000')
      .send({ title: 'Missing' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'CONTENT',
      status: 'RELEASED',
      title: 'Released title',
      description: 'Done',
      sourceUrl: 'https://anilist.co/anime/1',
      coverUrl: 'https://example.com/cover.jpg',
      proposerName: null,
      targetDate: null,
      introducedInVersion: '2.4.19',
      sortOrder: 9,
    });
    expect(missing.status).toBe(404);
  });
});
