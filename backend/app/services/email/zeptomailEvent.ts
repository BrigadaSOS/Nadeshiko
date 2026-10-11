import { EmailEvent, User } from '@app/models';
import { logger } from '@config/log';
import { recordEmailEvent } from './metrics';
import { normalizeAddress, softBouncedTooOften, suppress, SOFT_BOUNCE_THRESHOLD } from './suppression';

/** Accept documented array-wrapped and console scalar webhook fields, and retain the raw payload so an undocumented
 * shape can be checked later. */

/** Preserve unrecognised provider event names under their own name; recording an event we cannot act on is safer
 * than dropping it. */
const NAMES: Record<string, string> = {
  hardbounce: 'hard_bounce',
  hard_bounce: 'hard_bounce',
  softbounce: 'soft_bounce',
  soft_bounce: 'soft_bounce',
  feedback: 'complaint',
  feedback_loop: 'complaint',
  feedbackloop: 'complaint',
  complaint: 'complaint',
  emailopen: 'open',
  open: 'open',
  emailclick: 'click',
  click: 'click',
};

/** Provider verification posts realistic sample events, so recognise its fixed sample domain/reference and do not
 * apply those samples. */
const SAMPLE_DOMAIN = 'zylker.com';

type Json = Record<string, unknown>;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

interface ParsedPayload {
  event: string;
  requestId: string | null;
  emailReference: string | null;
  clientReference: string | null;
  recipients: string[];
  detailFor: (address: string) => Json;
  occurredAt: (detail: Json) => Date;
}

function parse(payload: Json): ParsedPayload {
  const message = asObject(first(payload.event_message));
  const emailInfo = asObject(message.email_info);
  const details = asArray(asObject(first(message.event_data)).details).map(asObject);

  const rawName = (asString(first(payload.event_name)) ?? '').toLowerCase();
  const event = NAMES[rawName] ?? NAMES[rawName.replace(/[\s_-]/g, '')] ?? rawName ?? 'unknown';

  /** Use `bounced_recipient` when present; fall back to `to` only when the event has no per-recipient detail. */
  const bounced = details
    .map((detail) => normalizeAddress(asString(detail.bounced_recipient)))
    .filter((address): address is string => address !== null);

  const recipients = bounced.length
    ? [...new Set(bounced)]
    : [
        ...new Set(
          asArray(emailInfo.to)
            .map(asObject)
            .map((entry) =>
              normalizeAddress(asString(asObject(entry.email_address).address) ?? asString(entry.address)),
            )
            .filter((address): address is string => address !== null),
        ),
      ];

  return {
    event: event || 'unknown',
    requestId: asString(payload.webhook_request_id) ?? asString(message.request_id),
    emailReference: asString(emailInfo.email_reference),
    clientReference: asString(emailInfo.client_reference),
    recipients,
    detailFor: (address) =>
      details.find((detail) => normalizeAddress(asString(detail.bounced_recipient)) === address) ?? details[0] ?? {},
    /** A missing provider timestamp is “now,” not a reason to reject an otherwise trusted event. */
    occurredAt: (detail) => {
      const stamp = asString(detail.time) ?? asString(emailInfo.processed_time);
      if (!stamp) return new Date();
      const parsed = new Date(stamp);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    },
  };
}

/** Record every verified event and return 200 for a payload without a recipient; retrying a payload that cannot be
 * acted on will not help. */
export async function recordZeptomailPayload(payload: Json): Promise<EmailEvent[]> {
  const parsed = parse(payload);

  const samples = parsed.recipients.filter((address) => address.endsWith(`@${SAMPLE_DOMAIN}`));
  if (samples.length) {
    logger.info({ 'email.samples': samples.length }, 'Ignoring sample recipient(s) from a ZeptoMail Verify probe');
  }
  const recipients = parsed.recipients.filter((address) => !address.endsWith(`@${SAMPLE_DOMAIN}`));

  const written: EmailEvent[] = [];

  for (const address of recipients) {
    const detail = parsed.detailFor(address);

    const created = await recordOne({
      address,
      event: parsed.event,
      reason: asString(detail.reason),
      diagnosticMessage: asString(detail.diagnostic_message),
      emailReference: parsed.emailReference,
      clientReference: parsed.clientReference,
      webhookRequestId: parsed.requestId,
      occurredAt: parsed.occurredAt(detail),
      payload,
    });

    // Apply suppression and metrics only after the event insert wins; webhook redelivery must not double-count or
    // suppress twice.
    if (!created) continue;

    written.push(created);
    recordEmailEvent(parsed.event);
    await applyEvent(created);
  }

  return written;
}

async function recordOne(fields: {
  address: string;
  event: string;
  reason: string | null;
  diagnosticMessage: string | null;
  emailReference: string | null;
  clientReference: string | null;
  webhookRequestId: string | null;
  occurredAt: Date;
  payload: Json;
}): Promise<EmailEvent | null> {
  if (fields.webhookRequestId) {
    const existing = await EmailEvent.findOneBy({
      webhookRequestId: fields.webhookRequestId,
      address: fields.address,
    });
    if (existing) return null;
  }

  try {
    const row = EmailEvent.create(fields);
    await row.save();
    return row;
  } catch (error) {
    // Two deliveries of the same webhook racing each other. The other one won,
    // and it applied the consequences.
    if (fields.webhookRequestId) {
      const existing = await EmailEvent.findOneBy({
        webhookRequestId: fields.webhookRequestId,
        address: fields.address,
      });
      if (existing) return null;
    }
    throw error;
  }
}

/** A hard bounce also clears `emailVerified`, so the account cannot retain a verified badge for a nonexistent
 * mailbox. */
async function applyEvent(event: EmailEvent): Promise<void> {
  if (event.event === 'hard_bounce') {
    await suppress({
      address: event.address,
      cause: 'hard_bounce',
      reason: event.diagnosticMessage ?? event.reason,
    });
    await clearEmailVerified(event.address);
    return;
  }

  if (event.event === 'complaint') {
    await suppress({
      address: event.address,
      cause: 'complaint',
      reason: event.reason,
    });
    return;
  }

  if (event.event === 'soft_bounce') {
    const count = await softBouncedTooOften(event.address);
    if (count < SOFT_BOUNCE_THRESHOLD) return;

    await suppress({
      address: event.address,
      cause: 'repeated_soft_bounce',
      reason: `${count} soft bounces in the last 7 days`,
    });
  }
}

/** Map Better Auth's `emailVerified` to the entity's `isVerified` property and `is_verified` column; there is only
 * one stored field. */
async function clearEmailVerified(address: string): Promise<void> {
  try {
    await User.createQueryBuilder()
      .update()
      .set({ isVerified: false })
      .where('LOWER(email) = :address', { address })
      .andWhere('is_verified = true')
      .execute();
  } catch (error) {
    // Suppression is already recorded before badge cleanup; cleanup failure must log, not 500 and invite webhook
    // redelivery.
    logger.warn({ err: error }, 'Could not clear emailVerified after a hard bounce');
  }
}
