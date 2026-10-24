import type { Request, Response } from 'express';
import { logger } from '@config/log';
import { recordWebhookRejected } from '@app/services/email/metrics';
import type { WebhookRejectReason } from '@app/services/email/metrics';
import * as auth from '@app/services/email/sesWebhookAuth';
import { recordSesEvent } from '@app/services/email/sesEvent';
import { WEBHOOK_SES_PATH } from './paths';

export { WEBHOOK_SES_PATH };

/** Fail closed on SNS deliveries of SES events: no secret, wrong password or a foreign topic are refused, and verified
 * deliveries that record nothing still return 200 so SNS does not retry them forever. Kept out of OpenAPI. */

const CONFIRM_TIMEOUT_MS = 10_000;

export async function handleSesWebhook(req: Request, res: Response): Promise<void> {
  const secret = auth.getWebhookSecret();
  const topicArn = auth.getTopicArn();

  if (!secret || !topicArn) {
    // 503 rather than 401: this is our fault, not the caller's, and every bounce arriving while it lasts is lost.
    reject(res, 'no_secret', 503);
    return;
  }

  const authorization = headerValue(req, 'authorization');
  if (!authorization) {
    // SNS sends credentials only after a challenge. Not counted as a rejection: it is the normal first half of every
    // delivery, and counting it would fire the authentication alert on healthy traffic.
    res.setHeader('WWW-Authenticate', 'Basic realm="ses-webhook"');
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }

  if (!auth.passwordMatches(auth.basicAuthPassword(authorization), secret)) {
    reject(res, 'unauthenticated', 401);
    return;
  }

  let envelope: Record<string, unknown>;
  try {
    const parsed = JSON.parse(typeof req.body === 'string' ? req.body : '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    envelope = parsed as Record<string, unknown>;
  } catch {
    reject(res, 'unparseable', 400);
    return;
  }

  if (envelope.TopicArn !== topicArn) {
    reject(res, 'unauthenticated', 403);
    return;
  }

  if (envelope.Type === 'SubscriptionConfirmation') {
    await confirmSubscription(envelope.SubscribeURL, res);
    return;
  }

  if (envelope.Type !== 'Notification') {
    logger.info({ 'sns.type': String(envelope.Type) }, 'Ignoring an SNS message that is not a notification');
    res.status(200).json({ received: 0 });
    return;
  }

  let sesEvent: Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(envelope.Message));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    sesEvent = parsed as Record<string, unknown>;
  } catch {
    reject(res, 'unparseable', 400);
    return;
  }

  const events = await recordSesEvent(sesEvent, String(envelope.MessageId ?? ''));
  res.status(200).json({ received: events.length });
}

async function confirmSubscription(subscribeUrl: unknown, res: Response): Promise<void> {
  if (!auth.isSnsSubscribeUrl(subscribeUrl)) {
    reject(res, 'unparseable', 400);
    return;
  }

  const response = await fetch(subscribeUrl, { signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS) });
  if (!response.ok) {
    logger.warn({ status: response.status }, 'SNS refused the subscription confirmation');
    res.status(502).json({ error: 'confirmation_failed' });
    return;
  }

  logger.info('Confirmed the SNS subscription for SES events');
  res.status(200).json({ confirmed: true });
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function reject(res: Response, reason: WebhookRejectReason, status: number): void {
  recordWebhookRejected(reason);
  logger.warn({ 'email.reason': reason }, 'Refused an SES webhook delivery');
  res.status(status).json({ error: reason });
}
