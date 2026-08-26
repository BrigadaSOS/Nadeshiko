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

  /**
   * `List-Unsubscribe-Post` is fired by the mailbox provider with nobody
   * present, and Gmail may send it more than once. A second call has to be as
   * quiet as the first, or a retry turns into a 4xx the provider records as a
   * failed unsubscribe.
   */
  it('is idempotent', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`);
    const second = await request(app).post(`/v1/email/unsubscribe?token=${encodeURIComponent(token)}`);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ unsubscribed: true });
  });

  /**
   * The preference lives in a shared `jsonb` blob, so the write has to merge.
   * Clobbering it would silently re-enable the activity log for anyone who had
   * turned it off — a privacy setting undone by an unrelated unsubscribe.
   */
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

  /**
   * An unsubscribe for an account that has since been deleted has already got
   * what it asked for. Answering 404 would make the provider record the opt-out
   * as failed and keep showing the reader a button that never works.
   */
  it('answers 200 for an account that no longer exists', async () => {
    const response = await request(app).post(`/v1/email/unsubscribe?token=${issueUnsubscribeToken(2_147_483_600)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unsubscribed: true });
  });

  it('requires a token', async () => {
    expect((await request(app).post('/v1/email/unsubscribe')).status).toBe(400);
  });

  /**
   * RFC 8058 one-click: the provider posts a fixed form body to the URI. The
   * token is in the query string precisely because that body is not ours, so
   * receiving it must change nothing.
   */
  it('ignores the fixed body a one-click unsubscribe sends', async () => {
    const response = await request(app)
      .post(`/v1/email/unsubscribe?token=${issueUnsubscribeToken(fixtures.users.regular.id)}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');

    expect(response.status).toBe(200);
    expect(await preferencesOf(fixtures.users.regular.id)).toMatchObject({ productEmails: { enabled: false } });
  });
});

/**
 * The preference page's pair.
 *
 * Both unauthenticated, both authenticating on the sealed token instead -- a
 * screen that first demanded a password is the pattern that turns an opt-out
 * into a spam complaint.
 */
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

  /**
   * SAFE TO PREFETCH. Mail scanners fetch every link in a message before the
   * recipient sees it, so the read must never be the thing that opts somebody
   * out.
   */
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

  /** The blunt option: one control, everything stops. */
  it('stops everything when the master goes off', async () => {
    const token = issueUnsubscribeToken(fixtures.users.regular.id);

    const response = await request(app).patch('/v1/email/preferences').send({ token, enabled: false }).expect(200);

    expect(response.body.enabled).toBe(false);
    expect(response.body.categories).toEqual({ recap: false, checkins: false, updates: false });
  });

  /**
   * A partial patch, so a reader on a page loaded ten minutes ago cannot revert
   * a change they made somewhere else in the meantime.
   */
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
    // Mounted directly rather than through `EmailRoutes`: this endpoint answers
    // a browser with a 302 and is registered by hand in `config/routes.ts`, so
    // there is no generated router carrying it.
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

  /**
   * A token we cannot read still has a person behind it. The home page is a
   * better answer for somebody who just clicked a link we mailed them than a
   * 400 about a token they never saw.
   */
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

  /**
   * The shape that actually reached us: one message, every link fetched inside a
   * few seconds. The reader still arrives -- they just arrive without an SDK to
   * be counted by, so eighteen scanner renders stop becoming eighteen people.
   */
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
