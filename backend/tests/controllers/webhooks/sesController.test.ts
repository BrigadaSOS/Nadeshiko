import { request } from '../../helpers/http';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { setupTestSuite } from '../../helpers/setup';
import { buildApplication } from '@config/application';
import { handleSesWebhook } from '@app/controllers/webhooks/sesController';
import { WEBHOOK_SES_PATH } from '@app/controllers/webhooks/paths';
import * as auth from '@app/services/email/sesWebhookAuth';
import { EmailEvent, EmailSuppression } from '@app/models';

setupTestSuite();

/** Build the real application because the text parser must run before JSON parsing; `createTestApp` does not mount
 * that middleware. */
const app = buildApplication({
  rateLimit: false,
  mountRoutes: (instance) => {
    instance.post(WEBHOOK_SES_PATH, handleSesWebhook);
  },
});

const SECRET = 'webhook-secret-for-tests';
const TOPIC = 'arn:aws:sns:eu-north-1:123456789012:nadeshiko-ses-events-test';
const AUTH = `Basic ${Buffer.from(`sns:${SECRET}`).toString('base64')}`;

/** `config` is frozen at module load and the app is already built, so stub the accessors rather than assign. */
let secretSpy: MockInstance;
let topicSpy: MockInstance;

beforeEach(() => {
  secretSpy = vi.spyOn(auth, 'getWebhookSecret').mockReturnValue(SECRET);
  topicSpy = vi.spyOn(auth, 'getTopicArn').mockReturnValue(TOPIC);
});

afterEach(() => {
  secretSpy.mockRestore();
  topicSpy.mockRestore();
  vi.restoreAllMocks();
});

function notification(address = 'gone@example.com', messageId = 'sns-1', topic = TOPIC) {
  return JSON.stringify({
    Type: 'Notification',
    MessageId: messageId,
    TopicArn: topic,
    Message: JSON.stringify({
      eventType: 'Bounce',
      bounce: { bounceType: 'Permanent', bouncedRecipients: [{ emailAddress: address }] },
      mail: { messageId: 'ses-1', destination: [address], tags: { kind: ['magic-link'] } },
    }),
  });
}

/** SNS labels its JSON `text/plain`; send it the same way so the text parser is what is under test. */
function post(body: string, authorization: string | null = AUTH) {
  const req = request(app).post(WEBHOOK_SES_PATH).set('Content-Type', 'text/plain; charset=UTF-8');
  return (authorization ? req.set('Authorization', authorization) : req).send(body);
}

describe('POST /v1/webhooks/ses', () => {
  it('records a bounce delivered by SNS and suppresses the address', async () => {
    const res = await post(notification());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1 });
    expect((await EmailSuppression.findOneBy({ address: 'gone@example.com' }))?.cause).toBe('hard_bounce');
  });

  it('challenges a request without credentials, which is how SNS learns to send them', async () => {
    const res = await post(notification(), null);

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(await EmailEvent.count()).toBe(0);
  });

  it('refuses a wrong password', async () => {
    const res = await post(notification(), `Basic ${Buffer.from('sns:wrong').toString('base64')}`);

    expect(res.status).toBe(401);
    expect(await EmailEvent.count()).toBe(0);
  });

  it("refuses another topic's events even with the right password", async () => {
    const res = await post(notification('gone@example.com', 'sns-1', 'arn:aws:sns:eu-north-1:123:other'));

    expect(res.status).toBe(403);
    expect(await EmailEvent.count()).toBe(0);
  });

  it('fails closed with 503 when no secret is configured', async () => {
    secretSpy.mockReturnValue(undefined);

    const res = await post(notification());

    expect(res.status).toBe(503);
    expect(await EmailEvent.count()).toBe(0);
  });

  it('confirms a subscription by following an SNS-hosted link', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<ok/>', { status: 200 }));
    const url = 'https://sns.eu-north-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc';

    const res = await post(JSON.stringify({ Type: 'SubscriptionConfirmation', TopicArn: TOPIC, SubscribeURL: url }));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(url, expect.anything());
  });

  it('never follows a confirmation link off SNS', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await post(
      JSON.stringify({ Type: 'SubscriptionConfirmation', TopicArn: TOPIC, SubscribeURL: 'https://evil.example/x' }),
    );

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is idempotent across SNS redelivery', async () => {
    await post(notification());
    const res = await post(notification());

    expect(res.body).toEqual({ received: 0 });
    expect(await EmailEvent.countBy({ address: 'gone@example.com' })).toBe(1);
  });
});
