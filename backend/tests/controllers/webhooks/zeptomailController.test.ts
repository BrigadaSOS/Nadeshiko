import { request } from '../../helpers/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { buildApplication } from '@config/application';
import { handleZeptomailWebhook } from '@app/controllers/webhooks/zeptomailController';
import { WEBHOOK_ZEPTOMAIL_PATH } from '@app/controllers/webhooks/paths';
import * as signature from '@app/services/email/zeptomailSignature';
import { EmailEvent, EmailSuppression } from '@app/models';

setupTestSuite();

/**
 * A dedicated app rather than `createTestApp`, which mounts only the subset of
 * routes its callers need. The middleware under test is in `buildApplication`
 * itself -- the text body parser that has to run before the JSON one -- so the
 * app has to be built the real way for this to prove anything.
 */
const app = buildApplication({
  rateLimit: false,
  mountRoutes: (instance) => {
    instance.post(WEBHOOK_ZEPTOMAIL_PATH, handleZeptomailWebhook);
  },
});

const PATH = WEBHOOK_ZEPTOMAIL_PATH;
const SECRET = 'webhook-secret-for-tests';

/**
 * `config` is frozen at module load and the app is already built by the time a
 * test runs, so the secret is stubbed at its accessor rather than assigned.
 */
let secretSpy: MockInstance;

beforeEach(() => {
  secretSpy = vi.spyOn(signature, 'getWebhookSecret').mockReturnValue(SECRET);
});

afterEach(() => {
  secretSpy.mockRestore();
});

function hardBounce(address = 'gone@example.com', requestId = 'wh-1') {
  return JSON.stringify({
    event_name: ['hardbounce'],
    webhook_request_id: requestId,
    event_message: [
      {
        email_info: { to: [{ email_address: { address } }], client_reference: 'magic-link' },
        event_data: [{ details: [{ bounced_recipient: address, reason: '550' }] }],
      },
    ],
  });
}

describe('POST /v1/webhooks/zeptomail', () => {
  /**
   * FAILS CLOSED. With no shared secret we cannot tell a real bounce from a
   * forged one, and a forged hard bounce suppresses an address and locks
   * somebody out of magic-link sign-in.
   *
   * 503 rather than 401 because this is our fault, not the caller's -- and every
   * bounce arriving while it lasts is one we never learn about.
   */
  it('answers 503 and records nothing when no secret is configured', async () => {
    secretSpy.mockReturnValue(undefined);

    const response = await request(app).post(PATH).set('Content-Type', 'application/json').send(hardBounce());

    expect(response.status).toBe(503);
    expect(await EmailEvent.count()).toBe(0);
    expect(await EmailSuppression.count()).toBe(0);
  });

  /**
   * The console offers a static authorization header; the docs describe an HMAC.
   * The console is what actually fires, so this is the path that must work.
   */
  it('accepts the static token header the console is configured with', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send(hardBounce());

    expect(response.status).toBe(200);
    expect(await EmailSuppression.findOneBy({ address: 'gone@example.com' })).not.toBeNull();
  });

  it('refuses a wrong static token', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', 'not-the-secret')
      .send(hardBounce());

    expect(response.status).toBe(401);
    expect(await EmailEvent.count()).toBe(0);
  });

  it('refuses a delivery carrying no authentication at all', async () => {
    const response = await request(app).post(PATH).set('Content-Type', 'application/json').send(hardBounce());

    expect(response.status).toBe(401);
  });

  /** The other half of "two ways in": the documented HMAC. */
  it('accepts a valid producer-signature instead', async () => {
    const body = hardBounce('hmac@example.com', 'wh-hmac');
    const signature = crypto.createHmac('sha256', SECRET).update(body).digest('base64');

    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('producer-signature', `sig=${signature}`)
      .send(body);

    expect(response.status).toBe(200);
    expect(await EmailSuppression.findOneBy({ address: 'hmac@example.com' })).not.toBeNull();
  });

  /**
   * The docs describe form-encoded `data=<urlencoded JSON>`. A handler that only
   * read `req.body` as JSON would reject every delivery in this shape.
   */
  it('accepts the form-encoded body shape the documentation describes', async () => {
    const json = hardBounce('form@example.com', 'wh-form');

    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send(`data=${encodeURIComponent(json)}`);

    expect(response.status).toBe(200);
    expect(await EmailSuppression.findOneBy({ address: 'form@example.com' })).not.toBeNull();
  });

  it('refuses a body it cannot parse, even when the token is right', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send('this is not json');

    expect(response.status).toBe(401);
  });

  it('refuses a JSON array, which is parseable but not a payload', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send('[1,2,3]');

    expect(response.status).toBe(401);
  });

  /**
   * ZeptoMail's retry behaviour is undocumented, so a redelivery must be a 200
   * with no second bounce rather than anything that invites a redelivery loop.
   */
  it('answers 200 to a replay and records it only once', async () => {
    const send = () =>
      request(app)
        .post(PATH)
        .set('Content-Type', 'application/json')
        .set('X-Nadeshiko-Webhook-Token', SECRET)
        .send(hardBounce('replay@example.com', 'wh-replay'));

    expect((await send()).status).toBe(200);
    const second = await send();

    expect(second.status).toBe(200);
    expect(second.body.received).toBe(0);
    expect(await EmailEvent.countBy({ address: 'replay@example.com' })).toBe(1);
  });

  /**
   * The Verify button POSTs sample payloads, not a ping. A sample feedback-loop
   * payload would otherwise fire a critical complaint tripwire on day one.
   */
  it('answers 200 to a Verify probe without recording its sample as a real event', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send(hardBounce('rebecca@zylker.com', 'wh-sample'));

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(0);
    expect(await EmailEvent.count()).toBe(0);
  });

  /** A verified payload we do nothing with is still a 200. */
  it('answers 200 to a verified event that implies no action', async () => {
    const response = await request(app)
      .post(PATH)
      .set('Content-Type', 'application/json')
      .set('X-Nadeshiko-Webhook-Token', SECRET)
      .send(
        JSON.stringify({
          event_name: ['emailopen'],
          webhook_request_id: 'wh-open',
          event_message: [{ email_info: { to: [{ email_address: { address: 'reader@example.com' } }] } }],
        }),
      );

    expect(response.status).toBe(200);
    expect(await EmailSuppression.count()).toBe(0);
  });
});
