import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application, Request, Response, NextFunction } from 'express';
import { buildApplication } from '@config/application';
import { UserRoutes } from '@config/routes';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import { AuthType, ApiKeyKind, ApiPermission } from '@app/models/ApiPermission';

/**
 * The Shirabe account-link endpoints.
 *
 * Two of them are behind an extra gate that a signed-in session is deliberately
 * NOT enough for, and that split is the thing worth testing rather than the CRUD
 * around it:
 *
 * - `/credential` hands out a live access token for another service. Anything a
 *   browser can fetch, an extension or a stray script on the page can fetch too.
 * - `/resync` and `/refused` accept a claim about our own stored state. A
 *   fingerprint a browser could post is a browser deciding when our copy looks
 *   stale, which is a free Shirabe round trip per request for anyone who wants
 *   one.
 *
 * The gate is a shared secret the Nitro proxy stamps on everything it forwards
 * -- including browser requests -- so it is only the INNER door; the outer one
 * is the proxy's own deny list. That is why a session alone must not open it.
 *
 * The connection service itself is stubbed: its behaviour has its own tests
 * (`tests/services/shirabe/connection.test.ts`), and what is under test here is
 * which callers reach it and what they are told.
 *
 * The SESSION requirement is deliberately not asserted per route. It comes from
 * `requireSession()` in the generated router, which this harness replaces with
 * its own auth middleware -- an assertion here would be testing the harness. It
 * is covered where it is decided: `tests/routes/routeAuthSpec.test.ts` checks
 * every one of these paths declares `SessionCookie` in the spec the router is
 * generated from.
 */
const service = {
  findConnection: vi.fn(),
  refreshStack: vi.fn(),
  startLink: vi.fn(),
  completeLink: vi.fn(),
  unlink: vi.fn(),
  getReaderAccessToken: vi.fn(),
  resyncStack: vi.fn(),
  markDisconnected: vi.fn(),
  missingScopes: vi.fn(() => [] as string[]),
};
vi.mock('@app/services/shirabe/connection', () => ({
  findConnection: (...a: unknown[]) => service.findConnection(...a),
  refreshStack: (...a: unknown[]) => service.refreshStack(...a),
  startLink: (...a: unknown[]) => service.startLink(...a),
  completeLink: (...a: unknown[]) => service.completeLink(...a),
  unlink: (...a: unknown[]) => service.unlink(...a),
  getReaderAccessToken: (...a: unknown[]) => service.getReaderAccessToken(...a),
  resyncStack: (...a: unknown[]) => service.resyncStack(...a),
  markDisconnected: (...a: unknown[]) => service.markDisconnected(...a),
  missingScopes: (...a: unknown[]) => service.missingScopes(...(a as [])),
}));

/** Whether the request looks like it came through our own frontend proxy. */
let fromInternalProxy = false;
vi.mock('@lib/internalProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lib/internalProxy')>()),
  isInternalProxyRequest: () => fromInternalProxy,
}));

setupTestSuite();

let app: Application;
let core: CoreFixtures;

function testAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const user = req.app.locals.testUser;
  if (user) {
    req.user = user;
    req.auth = {
      type: AuthType.SESSION,
      apiKey: { kind: ApiKeyKind.SERVICE, permissions: Object.values(ApiPermission) },
    };
  }
  next();
}

/**
 * A connection row, as the controller renders it. The full shape matters: the
 * generated route validates the response against the spec, so a partial double
 * would 500 rather than fail the assertion it was written for.
 */
function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    toJSON: (scopes: string[]) => ({
      needsUpgrade: scopes.length > 0,
      missingScopes: scopes,
      disconnected: false,
      linkedAt: '2026-08-01T00:00:00.000Z',
      scopes: ['lookup'],
      dictionaries: [],
      stackIsPrivate: false,
      ...overrides,
    }),
  };
}

beforeAll(async () => {
  core = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    beforeRoutes: [testAuthMiddleware],
    mountRoutes: (instance) => {
      instance.use('/', UserRoutes);
    },
  });
});

beforeEach(() => {
  app.locals.testUser = core.users.regular;
  fromInternalProxy = false;
  for (const fn of Object.values(service)) fn.mockReset();
  service.missingScopes.mockReturnValue([]);
});

describe('GET /v1/user/connections/shirabe', () => {
  it('reports no connection for a reader who has not linked', async () => {
    service.findConnection.mockResolvedValue(null);

    const res = await request(app).get('/v1/user/connections/shirabe');

    expect(res.status).toBe(200);
    expect(res.body.connection).toBeNull();
  });

  it('re-reads the stack every time, with no staleness window', async () => {
    // This is the page whose whole job is to show what Shirabe currently says,
    // to a reader who may have changed it seconds ago in another tab. A window
    // made it print the dictionaries they had just switched off.
    service.findConnection.mockResolvedValue(connectionRow());
    service.refreshStack.mockResolvedValue(connectionRow());

    await request(app).get('/v1/user/connections/shirabe');
    await request(app).get('/v1/user/connections/shirabe');

    expect(service.refreshStack).toHaveBeenCalledTimes(2);
  });

  it('renders whatever the refresh returned, not the row it started from', async () => {
    service.findConnection.mockResolvedValue(connectionRow({ linkedAt: '2020-01-01T00:00:00.000Z' }));
    service.refreshStack.mockResolvedValue(connectionRow({ linkedAt: '2026-08-30T00:00:00.000Z' }));

    const res = await request(app).get('/v1/user/connections/shirabe');

    expect(res.body.connection.linkedAt).toBe('2026-08-30T00:00:00.000Z');
  });

  it('surfaces the permissions a reader still has to approve', async () => {
    service.findConnection.mockResolvedValue(connectionRow());
    service.refreshStack.mockResolvedValue(connectionRow());
    service.missingScopes.mockReturnValue(['dictionaries.read']);

    const res = await request(app).get('/v1/user/connections/shirabe');

    expect(res.body.connection.missingScopes).toEqual(['dictionaries.read']);
  });

  it('does not try to refresh a link that is not there', async () => {
    service.findConnection.mockResolvedValue(null);

    await request(app).get('/v1/user/connections/shirabe');

    expect(service.refreshStack).not.toHaveBeenCalled();
  });
});

describe('POST /v1/user/connections/shirabe', () => {
  it('hands back somewhere to send the reader', async () => {
    service.startLink.mockReturnValue({ authorizeUrl: 'https://shirabe.test/oauth?state=abc', state: 'abc' });

    const res = await request(app).post('/v1/user/connections/shirabe').send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ authorizeUrl: expect.stringContaining('shirabe.test') });
  });

  it('starts the link for the signed-in reader, not for an id in the body', async () => {
    // A link is attached to a person; taking the id from the request would let
    // one reader attach their Shirabe account to another.
    service.startLink.mockReturnValue({ authorizeUrl: 'https://shirabe.test/oauth', state: 'abc' });

    await request(app).post('/v1/user/connections/shirabe').send({ userId: 99999 });

    expect(service.startLink).toHaveBeenCalledWith(core.users.regular.id);
  });
});

describe('POST /v1/user/connections/shirabe/callback', () => {
  it('completes the link and returns the connection', async () => {
    service.completeLink.mockResolvedValue(connectionRow());

    const res = await request(app)
      .post('/v1/user/connections/shirabe/callback')
      .send({ code: 'auth-code', state: 'state-1' });

    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ disconnected: false, missingScopes: [] });
  });

  it('passes the grant through with the reader it belongs to', async () => {
    service.completeLink.mockResolvedValue(connectionRow());

    await request(app).post('/v1/user/connections/shirabe/callback').send({ code: 'auth-code', state: 'state-1' });

    expect(service.completeLink).toHaveBeenCalledWith(core.users.regular.id, 'auth-code', 'state-1');
  });

  it('computes the missing scopes rather than assuming none', async () => {
    // Empty by construction -- `completeLink` refuses a grant that falls short
    // -- but computed so the two cannot drift.
    service.completeLink.mockResolvedValue(connectionRow());

    await request(app).post('/v1/user/connections/shirabe/callback').send({ code: 'c', state: 's' });

    expect(service.missingScopes).toHaveBeenCalled();
  });
});

describe('DELETE /v1/user/connections/shirabe', () => {
  it('unlinks and answers 204', async () => {
    service.unlink.mockResolvedValue(true);

    expect((await request(app).delete('/v1/user/connections/shirabe')).status).toBe(204);
  });

  it('404s a reader who had nothing linked', async () => {
    service.unlink.mockResolvedValue(false);

    expect((await request(app).delete('/v1/user/connections/shirabe')).status).toBe(404);
  });
});

describe('GET /v1/user/connections/shirabe/credential', () => {
  it('refuses a signed-in reader’s own browser', async () => {
    // The gate that matters: a session is not enough, because this returns a
    // live credential for another service.
    service.getReaderAccessToken.mockResolvedValue('shirabe-token');

    const res = await request(app).get('/v1/user/connections/shirabe/credential');

    expect(res.status).toBe(403);
  });

  it('does not even look the token up for a refused caller', async () => {
    await request(app).get('/v1/user/connections/shirabe/credential');

    expect(service.getReaderAccessToken).not.toHaveBeenCalled();
  });

  it('hands the token to our own frontend server', async () => {
    fromInternalProxy = true;
    service.getReaderAccessToken.mockResolvedValue('shirabe-token');

    const res = await request(app).get('/v1/user/connections/shirabe/credential');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: 'shirabe-token' });
  });

  it('404s when there is no token to hand out', async () => {
    // No link, or one Shirabe has refused. The lookup falls back to the service
    // key, exactly as an unlinked reader always did.
    fromInternalProxy = true;
    service.getReaderAccessToken.mockResolvedValue(null);

    expect((await request(app).get('/v1/user/connections/shirabe/credential')).status).toBe(404);
  });
});

describe('POST /v1/user/connections/shirabe/resync', () => {
  it('refuses a browser', async () => {
    // A fingerprint a browser could post is a browser deciding when our copy of
    // the stack looks stale -- a free Shirabe round trip per request.
    const res = await request(app).post('/v1/user/connections/shirabe/resync').send({ stackFingerprint: 'fp-1' });

    expect(res.status).toBe(403);
    expect(service.resyncStack).not.toHaveBeenCalled();
  });

  it('records the fingerprint the lookup route reported', async () => {
    fromInternalProxy = true;

    const res = await request(app).post('/v1/user/connections/shirabe/resync').send({ stackFingerprint: 'fp-1' });

    expect(res.status).toBe(204);
    expect(service.resyncStack).toHaveBeenCalledWith(core.users.regular.id, 'fp-1');
  });
});

describe('POST /v1/user/connections/shirabe/refused', () => {
  it('refuses a browser', async () => {
    const res = await request(app).post('/v1/user/connections/shirabe/refused').send({ status: 401 });

    expect(res.status).toBe(403);
    expect(service.findConnection).not.toHaveBeenCalled();
  });

  it('disconnects the link on a 401, which is what a dead key looks like', async () => {
    // This used to end at a `logger.warn`, so the reader kept their "Linked
    // as ..." card and kept paying a doomed round trip per word, forever.
    fromInternalProxy = true;
    service.findConnection.mockResolvedValue(connectionRow());

    const res = await request(app).post('/v1/user/connections/shirabe/refused').send({ status: 401 });

    expect(res.status).toBe(204);
    expect(service.markDisconnected).toHaveBeenCalled();
    expect(service.refreshStack).not.toHaveBeenCalled();
  });

  it('does NOT disconnect on a 403 -- the key works, it is missing a permission', async () => {
    // Confusing the two would unlink readers who only needed to re-approve a
    // permission, which is strictly worse than doing nothing.
    fromInternalProxy = true;
    service.findConnection.mockResolvedValue(connectionRow());

    await request(app).post('/v1/user/connections/shirabe/refused').send({ status: 403 });

    expect(service.markDisconnected).not.toHaveBeenCalled();
    expect(service.refreshStack).toHaveBeenCalled();
  });

  it('ignores a status that means neither', async () => {
    fromInternalProxy = true;
    service.findConnection.mockResolvedValue(connectionRow());

    const res = await request(app).post('/v1/user/connections/shirabe/refused').send({ status: 500 });

    expect(res.status).toBe(204);
    expect(service.markDisconnected).not.toHaveBeenCalled();
    expect(service.refreshStack).not.toHaveBeenCalled();
  });

  it('answers 204 for a reader with no link at all', async () => {
    // The caller is a lookup that has already answered; there is nothing it
    // could do with a failure but log it twice.
    fromInternalProxy = true;
    service.findConnection.mockResolvedValue(null);

    expect((await request(app).post('/v1/user/connections/shirabe/refused').send({ status: 401 })).status).toBe(204);
  });
});
