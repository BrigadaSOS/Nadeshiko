import type { Request, Response } from 'express';
import { logger } from '@config/log';
import { recordWebhookRejected } from '@app/services/email/metrics';
import type { WebhookRejectReason } from '@app/services/email/metrics';
import * as signature from '@app/services/email/zeptomailSignature';
import { SIGNATURE_HEADER, TOKEN_HEADER } from '@app/services/email/zeptomailSignature';
import { recordZeptomailPayload } from '@app/services/email/zeptomailEvent';
import { WEBHOOK_ZEPTOMAIL_PATH } from './paths';

export { WEBHOOK_ZEPTOMAIL_PATH };

/** Fail closed on ZeptoMail callbacks: no/wrong HMAC is rejected, verified no-op events return 200 to avoid retry
 * loops, and this provider route stays out of OpenAPI. */

export async function handleZeptomailWebhook(req: Request, res: Response): Promise<void> {
  const secret = signature.getWebhookSecret();

  if (!secret) {
    // 503 rather than 401: this is our fault, not the caller's, and every bounce
    // arriving while it lasts is one we will never learn about.
    reject(res, 'no_secret', 503);
    return;
  }

  const raw = typeof req.body === 'string' ? req.body : '';
  const payloadText = signature.extractPayload(raw);

  const authenticated =
    signature.tokenMatches(headerValue(req, TOKEN_HEADER), secret) ||
    signature.signatureValid({ header: headerValue(req, SIGNATURE_HEADER), payload: payloadText, secret });

  if (!authenticated) {
    reject(res, 'unauthenticated', 401);
    return;
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(payloadText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    reject(res, 'unparseable', 401);
    return;
  }

  const events = await recordZeptomailPayload(payload);

  if (events.length === 0) {
    // Either a Verify probe's sample payload, or a shape we could find no
    // recipient in. Both are a 200: a retry would produce the same nothing.
    logger.info('ZeptoMail webhook recorded no events');
  }

  res.status(200).json({ received: events.length });
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function reject(res: Response, reason: WebhookRejectReason, status: number): void {
  recordWebhookRejected(reason);
  logger.warn({ 'email.reason': reason }, 'Refused a ZeptoMail webhook delivery');
  res.status(status).json({ error: reason });
}
