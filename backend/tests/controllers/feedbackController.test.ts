import { request } from '../helpers/http';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import type { Application } from 'express';
import { setupTestSuite } from '../helpers/setup';
import { seedCoreFixtures, type CoreFixtures } from '../fixtures/core';

// The controller resolves the session itself — the route is public, so no auth
// middleware ever populates `req.user`. Mocked here because that is the only
// seam: the alternative is minting a real better-auth cookie per test.
const getSession = vi.fn();
vi.mock('@config/auth', () => ({
  auth: { api: { getSession: () => getSession() } },
}));

// Captured rather than sent. The assertions that matter are which sender the
// notification is attributed to and which address a reply would reach.
const sendFeedbackEmail = vi.fn();
vi.mock('@app/mailers/email', () => ({
  sendFeedbackEmail: (...args: unknown[]) => sendFeedbackEmail(...args),
}));

const { buildApplication } = await import('@config/application');
const { FeedbackRoutes } = await import('@config/routes');
const { Feedback } = await import('@app/models');
const { encryptSecret } = await import('@lib/secretBox');
const { config } = await import('@config/config');

setupTestSuite();

let app: Application;
let fixtures: CoreFixtures;

/** A token as the endpoint would have issued it, aged by `ageMs`. */
function tokenIssued(ageMs: number): string {
  return encryptSecret(JSON.stringify({ issuedAt: Date.now() - ageMs }), config.BETTER_AUTH_SECRET);
}

const VALID_TOKEN = () => tokenIssued(5_000);

beforeAll(async () => {
  fixtures = await seedCoreFixtures();
  app = buildApplication({
    rateLimit: false,
    mountRoutes: (instance) => {
      instance.use('/', FeedbackRoutes);
    },
  });
});

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(null);
  sendFeedbackEmail.mockReset().mockResolvedValue(undefined);
});

describe('GET /v1/feedback/token', () => {
  it('issues a token that the submit endpoint accepts', async () => {
    const res = await request(app).get('/v1/feedback/token');

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('issues a different token each time', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/v1/feedback/token'),
      request(app).get('/v1/feedback/token'),
    ]);

    expect(first.body.token).not.toBe(second.body.token);
  });
});

describe('POST /v1/feedback', () => {
  it('stores an anonymous message with its context', async () => {
    const res = await request(app)
      .post('/v1/feedback')
      .set('user-agent', 'TestBrowser/1.0')
      .set('accept-language', 'es-419,es;q=0.9,en;q=0.8')
      .set('cf-ipcountry', 'es')
      .send({
        body: '  The player stops after the first segment.  ',
        formToken: VALID_TOKEN(),
        email: 'Reader@Example.COM',
        pagePath: '/search?q=彼女',
        appVersion: '2.4.0',
        posthogSessionId: 'sess-1',
        posthogDistinctId: 'person-1',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });

    const stored = await Feedback.findOneOrFail({ where: { posthogSessionId: 'sess-1' } });
    expect(stored.body).toBe('The player stops after the first segment.');
    expect(stored.email).toBe('reader@example.com');
    expect(stored.userId).toBeNull();
    expect(stored.pagePath).toBe('/search?q=彼女');
    expect(stored.locale).toBe('es-419');
    expect(stored.country).toBe('ES');
    expect(stored.userAgent).toBe('TestBrowser/1.0');
    expect(stored.appVersion).toBe('2.4.0');
    expect(stored.posthogDistinctId).toBe('person-1');
    expect(stored.handledAt).toBeNull();
  });

  it('notifies with the sender as the reply address', async () => {
    await request(app)
      .post('/v1/feedback')
      .send({ body: 'Great site', formToken: VALID_TOKEN(), email: 'reader@example.com' });

    expect(sendFeedbackEmail).toHaveBeenCalledTimes(1);
    expect(sendFeedbackEmail.mock.calls[0][0]).toMatchObject({
      from: 'reader@example.com',
      message: 'Great site',
      replyTo: 'reader@example.com',
    });
  });

  it('attaches the account and ignores a typed email when there is a session', async () => {
    getSession.mockResolvedValue({
      user: { id: String(fixtures.users.kevin.id), email: fixtures.users.kevin.email, name: 'Kevin' },
    });

    await request(app)
      .post('/v1/feedback')
      .send({ body: 'From my account', formToken: VALID_TOKEN(), email: 'someone-else@example.com' });

    const stored = await Feedback.findOneOrFail({ where: { body: 'From my account' } });
    expect(stored.userId).toBe(fixtures.users.kevin.id);
    expect(stored.email).toBe(fixtures.users.kevin.email);
  });

  it('records the message as anonymous when the session lookup fails', async () => {
    getSession.mockRejectedValue(new Error('auth is down'));

    const res = await request(app).post('/v1/feedback').send({ body: 'Still gets through', formToken: VALID_TOKEN() });

    expect(res.status).toBe(201);
    const stored = await Feedback.findOneOrFail({ where: { body: 'Still gets through' } });
    expect(stored.userId).toBeNull();
  });

  it('still answers 201 when the notification cannot be queued', async () => {
    sendFeedbackEmail.mockRejectedValue(new Error('SES is down'));

    const res = await request(app).post('/v1/feedback').send({ body: 'Stored anyway', formToken: VALID_TOKEN() });

    expect(res.status).toBe(201);
    await expect(Feedback.findOneOrFail({ where: { body: 'Stored anyway' } })).resolves.toBeTruthy();
  });

  describe('bot signals answer 201 and store nothing', () => {
    it.each([
      ['a filled honeypot', { body: 'buy pills', formToken: VALID_TOKEN(), nickname: 'spammer' }],
      ['a submission faster than a person', { body: 'buy pills', formToken: tokenIssued(200) }],
      ['a forged token', { body: 'buy pills', formToken: 'not-a-real-token' }],
      ['a token older than its lifetime', { body: 'buy pills', formToken: tokenIssued(48 * 60 * 60 * 1000) }],
    ])('%s', async (_label, payload) => {
      const res = await request(app).post('/v1/feedback').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ received: true });
      expect(await Feedback.countBy({ body: 'buy pills' })).toBe(0);
      expect(sendFeedbackEmail).not.toHaveBeenCalled();
    });
  });

  it('rejects a malformed reply address rather than storing an unreachable one', async () => {
    const res = await request(app)
      .post('/v1/feedback')
      .send({ body: 'Reply to me', formToken: VALID_TOKEN(), email: 'not an address' });

    expect(res.status).toBe(400);
  });

  it('rejects an empty message', async () => {
    const res = await request(app).post('/v1/feedback').send({ body: '   ', formToken: VALID_TOKEN() });

    expect(res.status).toBe(400);
  });

  it('rejects a wall of links, so the sender can fix it', async () => {
    const links = Array.from({ length: 6 }, (_, i) => `https://spam${i}.example`).join(' ');

    const res = await request(app).post('/v1/feedback').send({ body: links, formToken: VALID_TOKEN() });

    expect(res.status).toBe(400);
    expect(await Feedback.countBy({ body: links })).toBe(0);
  });

  it('drops a page path that is not same-origin', async () => {
    await request(app)
      .post('/v1/feedback')
      .send({ body: 'Off-site path', formToken: VALID_TOKEN(), pagePath: '//evil.example/phish' });

    const stored = await Feedback.findOneOrFail({ where: { body: 'Off-site path' } });
    expect(stored.pagePath).toBeNull();
  });
});
