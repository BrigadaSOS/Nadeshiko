import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Application } from 'express';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';

const { buildApplication } = await import('@config/application');
const { EmailRoutes } = await import('@config/routes');
const { User } = await import('@app/models');
const { issueUnsubscribeToken } = await import('@app/services/email/unsubscribe');
const { EMAIL_LINK_PATH, LINK_BURST_CACHE, issueReturnToken } = await import('@app/services/email/returnLink');
const { handleEmailLinkClick } = await import('@app/controllers/emailController');
const { Cache } = await import('@lib/cache');
const { encryptSecret } = await import('@lib/secretBox');
const { config } = await import('@config/config');

setupTestSuite();

let app: Application;
let fixtures: CoreFixtures;

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    mountRoutes: (instance) => {
      instance.use('/', EmailRoutes);
    },
  });
});

beforeEach(async () => {
  await User.update({ id: fixtures.users.regular.id }, { preferences: {} });
});

async function preferencesOf(id: number) {
  const user = await User.findOneByOrFail({ id });
  return user.preferences;
}

describe('POST /v1/email/unsubscribe', () => {
  it('turns product emails off for the account the token names', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unsubscribed: true });
    expect(await preferencesOf(fixtures.users.regular.id)).toMatchObject({ productEmails: { enabled: false } });
  });

  /** Mailbox providers may POST `List-Unsubscribe-Post` with no user and retry it; a repeat must remain a successful
   * no-op, not become a recorded 4xx. */
  it('is idempotent', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const second = await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ unsubscribed: true });
  });

  /** Preferences share a `jsonb` object, so this update must merge rather than re-enable an unrelated setting. */
  it('leaves the reader other preferences alone', async () => {
    await User.update(
      { id: fixtures.users.regular.id },
      { preferences: { searchHistory: { enabled: false }, translationLanguages: ['ES'] } },
    );

    await request(app).post(`/v1/email/unsubscribe?token=${issueUnsubscribeToken(fixtures.users.regular.id)}`);

    expect(await preferencesOf(fixtures.users.regular.id)).toEqual({
      searchHistory: { enabled: false },
      translationLanguages: ['ES'],
      productEmails: { enabled: false },
    });
  });

  it('refuses a token it cannot read', async () => {
    const response = await request(app).post('/v1/email/unsubscribe?token=not-a-real-token');

    expect(response.status).toBe(400);
  });

  it('refuses a token sealed for another purpose', async () => {
    const foreign = encryptSecret(JSON.stringify({ userId: fixtures.users.regular.id }), config.BETTER_AUTH_SECRET, {
      purpose: 'feedback.form-token',
    });

    const response = await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(foreign)}`);

    expect(response.status).toBe(400);
    expect(await preferencesOf(fixtures.users.regular.id)).toEqual({});
  });

  /** A deleted account has already received the requested opt-out; returning 404 would make the provider treat it as
   * failed. */
  it('answers 200 for an account that no longer exists', async () => {
    const response = await request(app).post(`/v1/email/unsubscribe?token=${issueUnsubscribeToken(2_147_483_600)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unsubscribed: true });
  });

  it('requires a token', async () => {
    expect((await request(app).post('/v1/email/unsubscribe')).status).toBe(400);
  });

  /** RFC 8058 supplies its own fixed POST body; authenticate with the query token and ignore that body when opting
   * out. */
  it('ignores the fixed body a one-click unsubscribe sends', async () => {
    const response = await request(app)
      .post(`/v1/email/unsubscribe?token=${issueUnsubscribeToken(fixtures.users.regular.id)}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');

    expect(response.status).toBe(200);
    expect(await preferencesOf(fixtures.users.regular.id)).toMatchObject({ productEmails: { enabled: false } });
  });
});

/** Both preference-page endpoints are unauthenticated and authenticate with the sealed token; requiring a password
 * would turn an opt-out into a complaint. */
describe('reading preferences from a token', () => {
  it('resolves absent categories to what the master says', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).get('/v1/email/preferences').query({ token }).expect(200);

    expect(response.body.enabled).toBe(true);
    expect(response.body.categories).toEqual({ recap: true, checkins: true, updates: true });
  });

  /** The page highlights it, because it is the one the reader clicked about. */
  it('names the category the email belonged to', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id, 'recap');

    const response = await request(app).get('/v1/email/preferences').query({ token }).expect(200);

    expect(response.body.category).toBe('recap');
  });

  it('reports no category for a token that names none', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).get('/v1/email/preferences').query({ token }).expect(200);

    expect(response.body.category).toBeNull();
  });

  /** Mail scanners prefetch links, so this GET must never perform the opt-out. */
  it('changes nothing', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);
    await request(app).get('/v1/email/preferences').query({ token }).expect(200);

    const after = await User.findOneByOrFail({ id: fixtures.users.regular.id });
    expect(after.preferences?.productEmails?.enabled).toBeUndefined();
  });

  it('refuses a token it cannot read', async () => {
    await request(app).get('/v1/email/preferences').query({ token: 'not-a-token' }).expect(400);
  });
});

describe('changing preferences from a token', () => {
  it('turns one category off and leaves the others alone', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).patch('/v1/email/preferences').send({ token, recap: false }).expect(200);

    expect(response.body.categories).toEqual({ recap: false, checkins: true, updates: true });
    expect(response.body.enabled).toBe(true);
  });

  it('stops everything when the master goes off', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).patch('/v1/email/preferences').send({ token, enabled: false }).expect(200);

    expect(response.body.enabled).toBe(false);
    expect(response.body.categories).toEqual({ recap: false, checkins: false, updates: false });
  });

  /** Use a partial patch so a stale page cannot overwrite a preference changed elsewhere. */
  it('leaves untouched switches untouched across two writes', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    await request(app).patch('/v1/email/preferences').send({ token, recap: false }).expect(200);
    const response = await request(app).patch('/v1/email/preferences').send({ token, updates: false }).expect(200);

    expect(response.body.categories).toEqual({ recap: false, checkins: true, updates: false });
  });

  it('refuses a token it cannot read', async () => {
    await request(app).patch('/v1/email/preferences').send({ token: 'not-a-token', recap: false }).expect(400);
  });
});

describe('GET /v1/email/link', () => {
  const campaign = 'dormant-30-2026-08';

  let linkApp: Application;

  beforeAll(() => {
    // Mounted directly because this browser endpoint returns a 302 and is registered manually in `config/routes.ts`,
    // not in the generated router.
    linkApp = buildApplication({
      rateLimit: false,
      mountRoutes: (instance) => {
        instance.get(EMAIL_LINK_PATH, handleEmailLinkClick);
      },
    });
  });

  beforeEach(() => {
    Cache.invalidate(LINK_BURST_CACHE);
  });

  const token = () => issueReturnToken({ userId: fixtures.users.regular.id, kind: 'dormant-30', campaign });

  const follow = (query: Record<string, string>, headers: Record<string, string> = {}) => {
    const search = new URLSearchParams(query).toString();
    return request(linkApp).get(`${EMAIL_LINK_PATH}?${search}`).set(headers);
  };

  it('sends a reader to the destination, tagged', async () => {
    const response = await follow({ t: token(), to: '/media/frieren', c: 'title-1' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/media/frieren');
    expect(response.headers.location).toContain(`utm_campaign=${campaign}`);
    expect(response.headers.location).toContain('utm_content=title-1');
    expect(response.headers.location).not.toContain('nb=1');
  });

  /** An unreadable token still represents a user following a mailed link; send them to the home page rather than
   * expose a token error. */
  it('still lands somebody whose token is unreadable', async () => {
    const response = await follow({ t: 'rubbish', to: '/media/frieren', c: 'cta' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(config.BASE_URL);
  });

  /** Never a redirect off-site, whatever is in the query string. */
  it('refuses to forward to another host', async () => {
    const response = await follow({ t: token(), to: 'https://evil.example/x', c: 'cta' });

    expect(response.status).toBe(302);
    expect(response.headers.location.startsWith(config.BASE_URL)).toBe(true);
    expect(response.headers.location).not.toContain('evil.example');
  });

  it('marks a declared prefetch so the destination does not count it', async () => {
    const response = await follow({ t: token(), to: '/media/frieren', c: 'cta' }, { 'sec-purpose': 'prefetch' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('nb=1');
  });

  /** Coalesce scanner fetches so repeated renders do not inflate SDK events before the recipient arrives. */
  it('marks a message whose links are being walked', async () => {
    const t = token();
    await follow({ t, to: '/media/a', c: 'title-1' });
    await follow({ t, to: '/media/b', c: 'title-2' });
    const response = await follow({ t, to: '/media/c', c: 'title-3' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('nb=1');
    expect(response.headers.location).toContain('/media/c');
  });
});
