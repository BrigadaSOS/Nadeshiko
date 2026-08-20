import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Application } from 'express';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';

const { buildApplication } = await import('@config/application');
const { EmailRoutes } = await import('@config/routes');
const { User } = await import('@app/models');
const { issueUnsubscribeToken } = await import('@app/services/email/unsubscribe');
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
