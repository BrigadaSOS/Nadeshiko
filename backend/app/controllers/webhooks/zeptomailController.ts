import type { Request, Response } from 'express';
import { config } from '@config/config';
import { logger } from '@config/log';
import { recordWebhookRejected } from '@app/services/email/metrics';
import type { WebhookRejectReason } from '@app/services/email/metrics';
import {
  extractPayload,
  signatureValid,
  tokenMatches,
  SIGNATURE_HEADER,
  TOKEN_HEADER,
} from '@app/services/email/zeptomailSignature';
import { recordZeptomailPayload } from '@app/services/email/zeptomailEvent';
import { WEBHOOK_ZEPTOMAIL_PATH } from './paths';

export { WEBHOOK_ZEPTOMAIL_PATH };

/**
 * Bounce, complaint, open, and click notifications from ZeptoMail.
 *
 * FAILS CLOSED, and that is the whole design. With no shared secret we cannot
 * tell a real bounce from a forged one, and a forged hard bounce suppresses
 * somebody's address and locks them out of magic-link sign-in. Refusing is the
 * safe answer, not trusting.
 *
 *   no secret configured  ->  503, and nothing is recorded
 *   auth absent or wrong  ->  401
 *   body we cannot parse  ->  401
 *   verified              ->  200, ALWAYS
 *
 * A verified payload gets a 200 even for an event we do nothing with. ZeptoMail's
 * retry behaviour is undocumented, so anything else invites a redelivery loop
 * over a message we were never going to act on.
 *
 * This route is deliberately NOT in the OpenAPI spec. `backend/docs/openapi/`
 * feeds the generated routes and `packages/nadeshiko-sdk`; this is a provider
 * callback, not part of the API anybody should be building against, and putting
 * it in the spec would publish it in the SDK.
 */

export async function handleZeptomailWebhook(req: Request, res: Response): Promise<void> {
  const secret = config.ZEPTOMAIL_WEBHOOK_SECRET;

  if (!secret) {
    // 503 rather than 401: this is our fault, not the caller's, and every bounce
    // arriving while it lasts is one we will never learn about.
    reject(res, 'no_secret', 503);
    return;
  }

  const raw = typeof req.body === 'string' ? req.body : '';
  const payloadText = extractPayload(raw);

  const authenticated =
    tokenMatches(headerValue(req, TOKEN_HEADER), secret) ||
    signatureValid({ header: headerValue(req, SIGNATURE_HEADER), payload: payloadText, secret });

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
