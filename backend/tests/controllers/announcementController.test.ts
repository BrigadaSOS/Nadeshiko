import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { AdminRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { Announcement } from '@app/models';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

/**
 * The site-wide banner.
 *
 * It is read on every page load, so it is cached -- and that cache is the part
 * worth testing rather than the CRUD. Two things about it are easy to get wrong
 * and both fail silently:
 *
 * - The ABSENCE of an announcement has to be cached too. Caching only the hits
 *   means the ordinary case -- no banner, which is almost all of the time --
 *   queries the database on every single page view.
 * - Turning a banner off has to take effect now. A maintenance notice that
 *   stays up for another minute after being cleared is the one message where
 *   that matters, because it is the one that says something is broken.
 */
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

/** How many times the row was actually looked up, to tell a cache hit from a miss. */
function countReads() {
  const spy = vi.spyOn(Announcement, 'findOne');
  return { calls: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', AdminRoutes);
    },
  });
});

beforeEach(async () => {
  app.locals.testUser = core.users.kevin;
  vi.restoreAllMocks();
  await Announcement.query('DELETE FROM "Announcement"');
  // The banner cache has a one-minute TTL and no exported handle, so each case
  // starts by clearing it the way the app does: through the write endpoint.
  await request(app).put('/v1/admin/announcement').send({ message: 'reset', type: 'INFO', active: false });
  await Announcement.query('DELETE FROM "Announcement"');
});

describe('GET /v1/admin/announcement', () => {
  it('answers 204 when there is nothing to announce', async () => {
    // Not an empty 200: the banner component renders on a body, and "no
    // announcement" is the ordinary state rather than an empty announcement.
    const res = await request(app).get('/v1/admin/announcement');

    expect(res.status).toBe(204);
  });

  it('returns the active announcement', async () => {
    await Announcement.save(
      Announcement.create({ message: 'Scheduled maintenance', type: 'MAINTENANCE', active: true }),
    );

    const res = await request(app).get('/v1/admin/announcement');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Scheduled maintenance', type: 'MAINTENANCE', active: true });
  });

  it('ignores an announcement that is switched off', async () => {
    // The row is kept so the text can be re-enabled; `active` is what decides
    // whether anybody sees it.
    await Announcement.save(Announcement.create({ message: 'Old news', type: 'INFO', active: false }));

    const res = await request(app).get('/v1/admin/announcement');

    expect(res.status).toBe(204);
  });

  it('serves the second read from cache rather than querying again', async () => {
    await Announcement.save(Announcement.create({ message: 'Hello', type: 'INFO', active: true }));
    await request(app).get('/v1/admin/announcement');

    const reads = countReads();
    await request(app).get('/v1/admin/announcement');

    expect(reads.calls()).toBe(0);
  });

  it('caches the ABSENCE of an announcement too', async () => {
    // The case that is true almost all the time. Caching only the hits leaves
    // every page view querying for a banner that is not there.
    await request(app).get('/v1/admin/announcement');

    const reads = countReads();
    const res = await request(app).get('/v1/admin/announcement');

    expect(reads.calls()).toBe(0);
    expect(res.status).toBe(204);
  });
});

describe('PUT /v1/admin/announcement', () => {
  it('creates the announcement when there is none', async () => {
    const res = await request(app)
      .put('/v1/admin/announcement')
      .send({ message: 'We are up', type: 'INFO', active: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'We are up', type: 'INFO', active: true });
  });

  it('updates the existing row rather than adding a second', async () => {
    // There is one banner. A second row would make "the active announcement"
    // depend on insertion order.
    await request(app).put('/v1/admin/announcement').send({ message: 'First', type: 'INFO', active: true });

    await request(app).put('/v1/admin/announcement').send({ message: 'Second', type: 'WARNING', active: true });

    expect(await Announcement.count()).toBe(1);
    expect((await Announcement.findOneOrFail({ where: {} })).message).toBe('Second');
  });

  it('updates a row that is currently switched off', async () => {
    // The row is found by "any row", not "the active one" -- otherwise a banner
    // could never be turned back on through this endpoint.
    await Announcement.save(Announcement.create({ message: 'Old', type: 'INFO', active: false }));

    const res = await request(app).put('/v1/admin/announcement').send({ message: 'New', type: 'INFO', active: true });

    expect(res.body).toMatchObject({ message: 'New', active: true });
    expect(await Announcement.count()).toBe(1);
  });

  it.each(['INFO', 'WARNING', 'MAINTENANCE'] as const)('stores a %s announcement', async (type) => {
    const res = await request(app).put('/v1/admin/announcement').send({ message: 'Notice', type, active: true });

    expect(res.body.type).toBe(type);
  });

  it('makes a new banner visible immediately, not a minute later', async () => {
    await request(app).get('/v1/admin/announcement');

    await request(app).put('/v1/admin/announcement').send({ message: 'Now', type: 'WARNING', active: true });
    const res = await request(app).get('/v1/admin/announcement');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Now');
  });

  it('takes a banner DOWN immediately', async () => {
    // The one that matters most: a maintenance notice still showing after it
    // was cleared says the site is broken when it is not.
    await request(app)
      .put('/v1/admin/announcement')
      .send({ message: 'Down for maintenance', type: 'MAINTENANCE', active: true });
    await request(app).get('/v1/admin/announcement');

    await request(app)
      .put('/v1/admin/announcement')
      .send({ message: 'Down for maintenance', type: 'MAINTENANCE', active: false });
    const res = await request(app).get('/v1/admin/announcement');

    expect(res.status).toBe(204);
  });

  it('rejects a body missing the fields the banner needs', async () => {
    const res = await request(app).put('/v1/admin/announcement').send({ message: 'No type given' });

    expect(res.status).toBe(400);
  });

  it('rejects a type the banner cannot render', async () => {
    const res = await request(app)
      .put('/v1/admin/announcement')
      .send({ message: 'Notice', type: 'CATASTROPHE', active: true });

    expect(res.status).toBe(400);
  });
});
