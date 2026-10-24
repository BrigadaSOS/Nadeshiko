import type { EmailEvent } from '@app/models';
import { logger } from '@config/log';
import { recordEmailEvent } from './metrics';
import { applyEvent, recordOne } from './emailEvent';
import { normalizeAddress } from './suppression';

/** Parse the SES event JSON that SNS carries in a notification's `Message`. Bounces and complaints drive suppression;
 * rejects and rendering failures are recorded only, because they say nothing about the recipient. */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function asDate(value: unknown): Date {
  const stamp = asString(value);
  if (!stamp) return new Date();
  const parsed = new Date(stamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Rebuild `kind:campaign` from the two tags `sendViaSes` split it into. */
function clientReferenceFrom(mail: Json): string | null {
  const tags = asObject(mail.tags);
  const kind = asString(asArray(tags.kind)[0]);
  if (!kind) return null;
  const campaign = asString(asArray(tags.campaign)[0]);
  return campaign ? `${kind}:${campaign}` : kind;
}

interface Recipient {
  address: string;
  reason: string | null;
  diagnosticMessage: string | null;
}

interface Parsed {
  event: string;
  occurredAt: Date;
  recipients: Recipient[];
}

/** Undetermined bounces count as soft: suppressing on them would lock out readers over SES's own uncertainty. */
function parse(sesEvent: Json, mail: Json): Parsed {
  const type = asString(sesEvent.eventType) ?? asString(sesEvent.notificationType) ?? 'unknown';

  if (type === 'Bounce') {
    const bounce = asObject(sesEvent.bounce);
    const bounceType = asString(bounce.bounceType);
    return {
      event: bounceType === 'Permanent' ? 'hard_bounce' : 'soft_bounce',
      occurredAt: asDate(bounce.timestamp),
      recipients: asArray(bounce.bouncedRecipients)
        .map(asObject)
        .map((recipient) => ({
          address: asString(recipient.emailAddress) ?? '',
          reason: [bounceType, asString(bounce.bounceSubType)].filter(Boolean).join('/') || null,
          diagnosticMessage: asString(recipient.diagnosticCode),
        })),
    };
  }

  if (type === 'Complaint') {
    const complaint = asObject(sesEvent.complaint);
    return {
      event: 'complaint',
      occurredAt: asDate(complaint.timestamp),
      recipients: asArray(complaint.complainedRecipients)
        .map(asObject)
        .map((recipient) => ({
          address: asString(recipient.emailAddress) ?? '',
          reason: asString(complaint.complaintFeedbackType),
          diagnosticMessage: null,
        })),
    };
  }

  // Reject, Rendering Failure, Delivery and anything newer: record against every destination under SES's own name.
  const detail = asObject(sesEvent.reject ?? sesEvent.failure ?? sesEvent.delivery);
  return {
    event: type.toLowerCase().replace(/\s+/g, '_').slice(0, 32),
    occurredAt: asDate(detail.timestamp ?? mail.timestamp),
    recipients: asArray(mail.destination).map((address) => ({
      address: asString(address) ?? '',
      reason: asString(detail.reason) ?? asString(detail.errorMessage),
      diagnosticMessage: null,
    })),
  };
}

/** Record one SES event. `notificationId` is the SNS MessageId, which SNS repeats on redelivery, so it is the
 * idempotency key. */
export async function recordSesEvent(sesEvent: Json, notificationId: string): Promise<EmailEvent[]> {
  const mail = asObject(sesEvent.mail);
  const parsed = parse(sesEvent, mail);
  const clientReference = clientReferenceFrom(mail);
  const emailReference = asString(mail.messageId);

  const written: EmailEvent[] = [];
  const seen = new Set<string>();

  for (const recipient of parsed.recipients) {
    const address = normalizeAddress(recipient.address);
    if (!address || seen.has(address)) continue;
    seen.add(address);

    const created = await recordOne({
      address,
      event: parsed.event,
      reason: recipient.reason,
      diagnosticMessage: recipient.diagnosticMessage,
      emailReference,
      clientReference,
      webhookRequestId: notificationId,
      occurredAt: parsed.occurredAt,
      payload: sesEvent,
    });

    // Apply suppression and metrics only after the insert wins; redelivery must not double-count or suppress twice.
    if (!created) continue;

    written.push(created);
    recordEmailEvent(parsed.event);
    await applyEvent(created);
  }

  if (!written.length && !parsed.recipients.length) {
    logger.info({ 'email.event': parsed.event }, 'SES event named no recipient');
  }

  return written;
}
