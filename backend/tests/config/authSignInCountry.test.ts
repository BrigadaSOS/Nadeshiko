import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { buildAuthOptions } from '@config/auth';
import { config as configValues } from '@config/config';
import { TestDataSource } from '../helpers/setup';
import { resetRateLimiters } from '@app/middleware/rateLimit';

/**
 * The country columns, end to end through the real sign-in.
 *
 * Unit-testing `countryFromHeaders` proves the parsing and nothing else. The
 * risk that actually matters here is structural: better-auth only persists
 * fields it has been told about, so a hook can return a perfectly good value
 * and the adapter can drop it on the floor without an error. The only way to
 * know `additionalFields` and the hooks agree is to run a sign-up against a
 * real database and read the rows back.
 *
 * Drives the magic-link path because that is how accounts are actually opened
 * here, and because injecting `sendMagicLinkEmailFn` gets us the token without
 * sending mail.
 */

const EMAIL = 'country-probe@example.test';
const COUNTRY = 'CN';

let auth: ReturnType<typeof betterAuth>;
let pool: Pool;
let magicLinkUrl: string | null = null;

beforeAll(async () => {
  // `setupTestSuite` is deliberately NOT used here. It wraps each test in a
  // TypeORM transaction and rolls it back, which is right for tests that read
  // and write through TypeORM -- but this one writes through better-auth's own
  // pool and reads back through a third connection, and an uncommitted
  // transaction is invisible to both. The rollback would hide exactly the
  // cross-table write (`recordLastSeen` -> `User`) this test exists to prove.
  // So the DataSource is initialised bare -- `sendMagicLink`'s suppression
  // check needs it -- and cleanup is done by hand below.
  if (!TestDataSource.isInitialized) await TestDataSource.initialize();

  pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  auth = betterAuth(
    buildAuthOptions({
      databasePool: pool,
      // Captures the link instead of mailing it. Everything else -- the hooks,
      // the adapter, the schema -- is exactly what production runs.
      sendMagicLinkEmailFn: async (_email: string, url: string) => {
        magicLinkUrl = url;
      },
      // The sign-up side effects are not what this test is about, and both
      // reach outside the process.
      sendWelcomeEmailFn: async () => {},
      captureAccountCreatedFn: () => {},
    }),
  );
});

afterAll(async () => {
  await deleteProbeUser();
  await pool.end();
  if (TestDataSource.isInitialized) await TestDataSource.destroy();
});

beforeEach(async () => {
  // The magic-link limiter is an in-process singleton shared across the run, and
  // this file signs in several times per test.
  resetRateLimiters();
  magicLinkUrl = null;
  await deleteProbeUser();
});

/**
 * `Collection` carries TWO foreign keys to `User` -- a cascading one and a
 * non-cascading leftover -- so deleting the account outright fails once
 * `ensureDefaultCollections` has run. Collections go first. (The duplicate
 * constraint is a real schema bug, not a test artifact; it breaks account
 * deletion in production too.)
 */
async function deleteProbeUser(): Promise<void> {
  await pool.query('DELETE FROM "Collection" WHERE user_id IN (SELECT id FROM "User" WHERE email = $1)', [EMAIL]);
  await pool.query('DELETE FROM "User" WHERE email = $1', [EMAIL]);
}

/** A sign-in carrying whatever Cloudflare would have put on the request. */
async function signIn(headers: Record<string, string>): Promise<void> {
  const base = `${configValues.BASE_URL}/v1/auth`;

  await auth.handler(
    new Request(`${base}/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email: EMAIL, callbackURL: '/' }),
    }),
  );

  expect(magicLinkUrl, 'the magic link should have been minted').toBeTruthy();
  const token = new URL(magicLinkUrl as string).searchParams.get('token');
  expect(token, 'the link should carry a token').toBeTruthy();

  // The click. This is the request that creates both the account and the
  // session, so it is the one that has to carry the header.
  await auth.handler(new Request(`${base}/magic-link/verify?token=${token}`, { method: 'GET', headers }));
}

async function rows() {
  const user = await pool.query<{
    signup_country: string | null;
    last_seen_country: string | null;
    last_seen_at: Date | null;
    id: number;
  }>('SELECT id, signup_country, last_seen_country, last_seen_at FROM "User" WHERE email = $1', [EMAIL]);
  const session = await pool.query<{ country: string | null }>(
    'SELECT country FROM session WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [user.rows[0]?.id],
  );
  return { user: user.rows[0], session: session.rows[0] };
}

describe('sign-in records where the request came from', () => {
  it('stores the country on both the account and the session', async () => {
    await signIn({ 'cf-ipcountry': COUNTRY });

    const { user, session } = await rows();
    expect(user?.signup_country).toBe(COUNTRY);
    expect(session?.country).toBe(COUNTRY);
    expect(user?.last_seen_country).toBe(COUNTRY);
    expect(user?.last_seen_at).toBeInstanceOf(Date);
  });

  /**
   * Off-Cloudflare -- local development, a container probe -- there is no
   * header, and a sign-in must still succeed with both columns null.
   */
  it('signs in with no country when the header is absent', async () => {
    await signIn({});

    const { user, session } = await rows();
    expect(user, 'the account should still have been created').toBeTruthy();
    expect(user?.signup_country).toBeNull();
    expect(session?.country).toBeNull();
    // Still seen, just not placed.
    expect(user?.last_seen_at).toBeInstanceOf(Date);
    expect(user?.last_seen_country).toBeNull();
  });

  /**
   * The column is set once, at creation. A reader who later signs in from
   * elsewhere moves `session.country` and leaves `signup_country` alone --
   * that separation is the whole reason there are two columns.
   */
  it('does not rewrite the signup country on a later sign-in', async () => {
    await signIn({ 'cf-ipcountry': COUNTRY });
    await signIn({ 'cf-ipcountry': 'JP' });

    const { user, session } = await rows();
    expect(user?.signup_country).toBe(COUNTRY);
    expect(session?.country).toBe('JP');
    // last-seen follows the reader; signup does not.
    expect(user?.last_seen_country).toBe('JP');
  });

  /**
   * A sign-in from somewhere Cloudflare cannot place must not erase the last
   * country we did know -- absent is not the same as none.
   */
  it('keeps the previous last-seen country when a later request has no header', async () => {
    await signIn({ 'cf-ipcountry': COUNTRY });
    await signIn({});

    const { user } = await rows();
    expect(user?.last_seen_country).toBe(COUNTRY);
    expect(user?.last_seen_at).toBeInstanceOf(Date);
  });
});
