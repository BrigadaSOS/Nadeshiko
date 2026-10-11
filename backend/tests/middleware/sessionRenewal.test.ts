import { request } from '../helpers/http';
import express, { type Request, type Response, type ErrorRequestHandler } from 'express';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';
import type { User } from '@app/models';
import { requestIdMiddleware } from '@app/middleware/requestId';
import { requireSessionAuth } from '@app/middleware/authentication';
import { handleErrors } from '@app/middleware/errorHandler';
import { auth, buildAuthOptions } from '@config/auth';
import { betterAuth } from 'better-auth';

/** Exercise real signed-cookie renewal using an existing fixture; account creation can deadlock the TypeORM test
 * transaction with better-auth's pool. */
setupTestSuite();

let fixtures: CoreFixtures;
let magicUrl = '';

/** Build a second better-auth instance from the same options and inject the mail hook at build time; the singleton
 * reads that dependency once, so a later spy cannot replace it. */
/** The widened options type hides the magic-link plugin endpoints, but the plugin is installed at runtime; these
 * explicit paths keep the test type-safe. */
type LinkAuth = {
  api: {
    signInMagicLink: (args: { body: { email: string }; headers: Headers }) => Promise<unknown>;
    magicLinkVerify: (args: {
      query: { token: string };
      headers: Headers;
      returnHeaders: true;
    }) => Promise<{ headers: Headers; response: { token: string } }>;
  };
};

/** The singleton has the same widened options type, so admin endpoints are hidden statically even though the runtime
 * plugin provides them. */
type AdminApi = {
  impersonateUser: (args: {
    body: { userId: string };
    headers: Headers;
    returnHeaders: true;
  }) => Promise<{ headers: Headers }>;
};

const linkAuth = betterAuth(
  buildAuthOptions({
    sendMagicLinkEmailFn: async (_email: string, url: string) => {
      magicUrl = url;
    },
  }),
) as unknown as LinkAuth;
beforeAll(async () => {
  fixtures = await seedCoreFixtures();
});

afterEach(async () => {
  const ctx = await auth.$context;
  // better-auth writes through its own pool, so these rows outlive the per-test
  // transaction rollback and have to be cleared by hand.
  for (const user of [fixtures.users.regular, fixtures.users.kevin, fixtures.users.david]) {
    await ctx.adapter
      .delete({ model: 'session', where: [{ field: 'userId', value: String(user.id) }] })
      .catch(() => {});
  }
});

let _app: ReturnType<typeof express> | null = null;
function createSessionApp() {
  if (_app) return _app;
  const app = express();
  app.use(requestIdMiddleware);
  app.use(express.json());
  app.use(requireSessionAuth);
  app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({ userId: req.user?.id });
  });
  app.use(handleErrors as ErrorRequestHandler);
  _app = app;
  return app;
}

/** Signs a fixture user in for real and hands back their signed cookie. */
async function signIn(user: User) {
  const ctx = await auth.$context;

  magicUrl = '';
  // `headers` is not optional: both endpoints declare `requireHeaders`, and an
  // empty set is enough -- there is no session to read yet.
  await linkAuth.api.signInMagicLink({ body: { email: user.email }, headers: new Headers() });
  const token = new URL(magicUrl).searchParams.get('token');
  expect(token).toBeTruthy();

  const verified = await linkAuth.api.magicLinkVerify({
    query: { token: token as string },
    headers: new Headers(),
    returnHeaders: true,
  });
  const cookieName = ctx.authCookies.sessionToken.name;
  const setCookie = verified.headers.getSetCookie().find((entry: string) => entry.startsWith(`${cookieName}=`));
  expect(setCookie).toBeTruthy();

  return {
    ctx,
    cookieName,
    // Name=value only, which is all a browser sends back.
    cookie: (setCookie as string).split(';')[0] as string,
    sessionToken: verified.response.token,
  };
}

function renewedCookie(res: { headers: Record<string, unknown> }, cookieName: string): string | undefined {
  const setCookies = res.headers['set-cookie'] as string[] | undefined;
  return setCookies?.find((entry) => entry.startsWith(`${cookieName}=`));
}

describe('session renewal on an authenticated API call', () => {
  it('renews the browser cookie once the session is due a refresh, and not before', async () => {
    const { ctx, cookieName, cookie, sessionToken } = await signIn(fixtures.users.regular);
    const app = createSessionApp();

    // Nothing to renew in the first week, and nothing sent: this is the steady
    // state, and it is what keeps the header off every API response.
    const fresh = await request(app).get('/test').set('Cookie', cookie);
    expect(fresh.status).toBe(200);
    expect(fresh.headers['set-cookie']).toBeUndefined();

    // Sessions refresh after seven days of age, not only near expiry; the renewed cookie must carry the full lifetime.
    const stale = new Date(Date.now() + 22 * 24 * 60 * 60 * 1000);
    await ctx.adapter.update({
      model: 'session',
      where: [{ field: 'token', value: sessionToken }],
      update: { expiresAt: stale },
    });

    const due = await request(app).get('/test').set('Cookie', cookie);
    expect(due.status).toBe(200);

    const renewed = renewedCookie(due, cookieName);
    expect(renewed).toBeTruthy();
    // A fresh full lifetime is the point of the exercise: a cookie renewed
    // without one would leave the browser dropping the session on the old
    // schedule.
    expect(renewed).toMatch(/Max-Age=7776000/i);

    // And the row moved with it. Both halves of the session now slide together,
    // which is the invariant this whole change exists to restore.
    const row = await ctx.adapter.findOne<{ expiresAt: Date }>({
      model: 'session',
      where: [{ field: 'token', value: sessionToken }],
    });
    expect(new Date((row as { expiresAt: Date }).expiresAt).getTime()).toBeGreaterThan(stale.getTime());
  });

  it('treats an admin session as an ordinary one', async () => {
    // Do not assert a special admin cap: the historical create hook gave eight hours but the first refresh restored the
    // full lifetime. This test pins the current behavior.
    const { ctx, cookie, sessionToken } = await signIn(fixtures.users.kevin);

    const before = await ctx.adapter.findOne<{ expiresAt: Date; createdAt: Date }>({
      model: 'session',
      where: [{ field: 'token', value: sessionToken }],
    });
    const createdAt = new Date((before as { createdAt: Date }).createdAt).getTime();
    const fullLifetime = createdAt + 90 * 24 * 60 * 60 * 1000;
    expect(new Date((before as { expiresAt: Date }).expiresAt).getTime()).toBeCloseTo(fullLifetime, -4);

    // And with a full lifetime ahead of it, nothing is due: an admin's
    // requests cost no session write and carry no cookie, same as anyone's.
    const res = await request(createSessionApp()).get('/test').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('holds an impersonation session to half an hour across a refresh', async () => {
    // Use `david`, not `kevin`: the process-level 14-minute magic-link cooldown would suppress the second link for the
    // admin used above.
    const { ctx, cookie: adminCookie } = await signIn(fixtures.users.david);

    const impersonated = await (auth.api as unknown as AdminApi).impersonateUser({
      body: { userId: String(fixtures.users.regular.id) },
      headers: new Headers({ cookie: adminCookie }),
      returnHeaders: true,
    });
    // The LAST match, not the first: better-auth expires the admin's own
    // session cookie (`Max-Age=0`, empty value) before writing the impersonated
    // one, so the first entry under this name is the empty one.
    const cookieName = ctx.authCookies.sessionToken.name;
    const setCookie = impersonated.headers
      .getSetCookie()
      .findLast((entry: string) => entry.startsWith(`${cookieName}=`) && !entry.startsWith(`${cookieName}=;`));
    expect(setCookie).toBeTruthy();
    const cookie = (setCookie as string).split(';')[0] as string;

    // Omit `dont_remember`: it disables refresh, so including it would bypass the clamp this test must exercise.
    const res = await request(createSessionApp()).get('/test').set('Cookie', cookie);
    expect(res.status).toBe(200);

    const rows = await ctx.adapter.findMany<{ expiresAt: Date; createdAt: Date; impersonatedBy: string | null }>({
      model: 'session',
      where: [{ field: 'userId', value: String(fixtures.users.regular.id) }],
    });
    const row = rows.find((candidate) => candidate.impersonatedBy);
    expect(row).toBeTruthy();

    const cap = new Date((row as { createdAt: Date }).createdAt).getTime() + 30 * 60 * 1000;
    expect(new Date((row as { expiresAt: Date }).expiresAt).getTime()).toBeCloseTo(cap, -4);
  });
});
