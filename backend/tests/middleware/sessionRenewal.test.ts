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

/**
 * The renewal, against real better-auth rather than a mocked `getSession`.
 *
 * Everything about this behaviour is invisible until it is far too late: a
 * session that has stopped sliding looks exactly like one that is sliding,
 * right up to the thirtieth day after sign-in, when a reader who has been here
 * every day is signed out. The unit tests above cover which cookies are
 * forwarded; this one covers the part that actually broke -- whether
 * better-auth hands the renewed cookie to this middleware at all, and whether
 * the middleware puts it on the response the browser is waiting for.
 *
 * The session is minted through the real magic-link flow because the cookie is
 * SIGNED: there is no honest way to fabricate one from outside, and a test that
 * reimplemented the signing would be testing its own copy of better-auth's
 * internals rather than better-auth.
 *
 * It signs in an EXISTING fixture user rather than creating an account. Account
 * creation runs `databaseHooks.user.create.after`, which writes through TypeORM
 * while better-auth still holds its own transaction open on the new row -- with
 * this file's per-test transaction in the middle, the two wait on each other and
 * the suite hangs rather than fails.
 *
 * And a NON-ADMIN one, which is not incidental. `databaseHooks.session.create`
 * gives an admin 8 hours instead of 30 days, which puts their session past the
 * refresh threshold the moment it is created -- so an admin would renew on the
 * very first request and this file could not tell the two states apart. (That
 * an admin's 8-hour cap is then rewritten to a full 30 days by the first
 * refresh is a real hole in that cap, and it is not this test's subject.)
 */
setupTestSuite();

let fixtures: CoreFixtures;
let magicUrl = '';

/**
 * A second better-auth instance that hands the magic link to this file instead
 * of to the mailer, built from the same options -- so the same secret, the same
 * cookie names, the same pool and the same session table as the singleton the
 * middleware uses. A cookie minted here is therefore a cookie the middleware
 * accepts, which is the entire trick.
 *
 * Injected rather than spied: `buildAuthOptions` reads `sendMagicLinkEmail`
 * once, at module load, into the options object, so a later `vi.spyOn` on the
 * mailer module changes nothing the singleton will ever call. That dependency
 * seam exists for exactly this.
 */
/**
 * The two endpoints used below, spelled out because the inference is gone:
 * `buildAuthOptions` returns a widened `BetterAuthOptions` (it casts on the way
 * out), so the instance built from it has no idea the magic-link plugin is
 * installed. Runtime is unaffected -- the plugin is right there in the options.
 */
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

/**
 * Same erasure on the singleton: `auth` is built from the same widened options,
 * so the admin plugin's endpoints are invisible to the type system even though
 * they are very much there at runtime.
 */
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

    // Sessions last 90 days and slide once they are 7 days old, so anything
    // expiring in under 83 is due. A reader who kept visiting used to reach
    // this state and never leave it: the row slid, the cookie did not, and the
    // browser dropped the session a lifetime after sign-in regardless.
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
    // Deliberate, and worth a test because the opposite was true for a long
    // time in the config and never once in practice: a create hook gave admins
    // eight hours and the first refresh -- about five minutes later -- handed
    // the full lifetime back. Enforcing that cap for real would have been a
    // change to how the site had always actually behaved, so it was dropped
    // instead. This pins the decision: nothing special happens to an admin, and
    // a half-built cap that only moves one of the two horizons fails here.
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
    // The most privileged session on the site -- an admin acting as someone
    // else's account -- and the one the unclamped refresh stretched furthest,
    // from 30 minutes to 30 days. It is checked before the role because the
    // session belongs to the impersonated account, which is usually not an
    // admin at all.
    // `david`, not `kevin`: `sendMagicLink` keeps a 14-minute per-user
    // cooldown in a process-level cache, so the admin who signed in for the
    // test above would silently get no link at all.
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

    // Deliberately WITHOUT the `dont_remember` cookie that rides along with an
    // impersonation. While a browser sends that, better-auth skips the refresh
    // outright and the clamp is never consulted -- so sending it here would
    // make this test pass without exercising anything. What is left is the case
    // the clamp is actually for: a refresh that does fire on this session.
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
