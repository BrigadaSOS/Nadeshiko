import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { buildAuthOptions } from '@config/auth';
import { config as configValues } from '@config/config';
import { TestDataSource } from '../helpers/setup';
import { resetRateLimiters } from '@app/middleware/rateLimit';

/** Exercise country persistence through real sign-in: better-auth can discard hook fields unless `additionalFields`
 * and the hooks agree. The magic-link path gets a token without mail. */

const EMAIL = 'country-probe@example.test';
const COUNTRY = 'CN';

let auth: ReturnType<typeof betterAuth>;
let pool: Pool;
let magicLinkUrl: string | null = null;

beforeAll(async () => {
  // Do not use `setupTestSuite`: its TypeORM transaction cannot contain better-auth's separate pool write and
  // third-connection read. Use a bare DataSource and clean up manually.
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

/** Delete collections before the probe account; this also tolerates the historical non-cascading foreign key. */
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

  /** Without Cloudflare headers, local/container sign-in still succeeds with both country columns null. */
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

  /** `signup_country` is set only at creation; later sign-ins update `session.country` and leave it alone. */
  it('does not rewrite the signup country on a later sign-in', async () => {
    await signIn({ 'cf-ipcountry': COUNTRY });
    await signIn({ 'cf-ipcountry': 'JP' });

    const { user, session } = await rows();
    expect(user?.signup_country).toBe(COUNTRY);
    expect(session?.country).toBe('JP');
    // last-seen follows the reader; signup does not.
    expect(user?.last_seen_country).toBe('JP');
  });

  /** A sign-in without a Cloudflare country must not erase the last known country: absent is not none. */
  it('keeps the previous last-seen country when a later request has no header', async () => {
    await signIn({ 'cf-ipcountry': COUNTRY });
    await signIn({});

    const { user } = await rows();
    expect(user?.last_seen_country).toBe(COUNTRY);
    expect(user?.last_seen_at).toBeInstanceOf(Date);
  });
});
