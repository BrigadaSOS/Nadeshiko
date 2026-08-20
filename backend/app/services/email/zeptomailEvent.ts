import { EmailEvent, User } from '@app/models';
import { logger } from '@config/log';
import { recordEmailEvent } from './metrics';
import { normalizeAddress, softBouncedTooOften, suppress, SOFT_BOUNCE_THRESHOLD } from './suppression';

/**
 * Turns one verified ZeptoMail webhook into EmailEvent rows and whatever they
 * imply. All provider-shaped parsing lives in this file.
 *
 * THE PARSING IS DELIBERATELY FORGIVING ABOUT ARRAYS. ZeptoMail wraps several of
 * these fields in a single-element array (`event_name`, `event_message`,
 * `event_data`) and the published documentation does not carry a complete
 * sample, so every level accepts either form and the raw payload is stored
 * whole. When the first real bounce arrives, `EmailEvent.payload` is what tells
 * us whether this guessed right.
 */

/**
 * Left side is what ZeptoMail sends, right side is ours. An unrecognised name is
 * still recorded, under its own name: losing an event we did not anticipate is
 * worse than holding one we cannot act on.
 */
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

/**
 * ZeptoMail's "Verify" button POSTs SAMPLE PAYLOADS at the URL, not a ping, and
 * they look exactly like real events: `zylker.com` recipients and a fixed
 * client_reference. Configuring the webhook at shirabe wrote five of them into
 * its events table, and the only reason it did no harm is that the samples
 * happened to be opens and a soft bounce.
 *
 * A sample FEEDBACK LOOP payload would have fired a critical complaint tripwire
 * on day one and taught everyone the channel cries wolf. zylker.com is Zoho's
 * fictional company, used throughout their documentation and never a real
 * recipient.
 */
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

  /**
   * `bounced_recipient` is the authoritative one: a message to three people can
   * bounce for one of them. The `to` list is the fallback for events that carry
   * no per-recipient detail at all (an open, say).
   */
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
    /**
     * ZeptoMail's own timestamps have gone missing from a payload before being
     * documented, so a missing one is "now" rather than a validation failure on
     * an event we already believe.
     */
    occurredAt: (detail) => {
      const stamp = asString(detail.time) ?? asString(emailInfo.processed_time);
      if (!stamp) return new Date();
      const parsed = new Date(stamp);
      return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    },
  };
}

/**
 * Record every event in one verified payload, and apply what each one implies.
 *
 * Returns the events actually written. An empty array is a payload we could not
 * find a real recipient in: worth a log line and a 200, because retrying it would
 * not help.
 */
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

    // A redelivery of an event we already applied must not suppress twice, nor
    // count twice: the metric is what the alert rules divide, so a double count
    // would inflate the bounce rate on a webhook retry rather than on a bounce.
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

/**
 * What an event means for whether we write to this address again.
 *
 * A hard bounce also clears `emailVerified`, so the account UI can ask for a
 * working address rather than leaving somebody with a verified badge on a
 * mailbox that does not exist.
 */
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

/**
 * better-auth calls this `emailVerified`; the column it is mapped onto is
 * `User.is_verified` (config/auth.ts), which the User entity already exposes as
 * `isVerified`. One field, three names -- worth stating so nobody goes looking
 * for an `emailVerified` column that does not exist.
 */
async function clearEmailVerified(address: string): Promise<void> {
  try {
    await User.createQueryBuilder()
      .update()
      .set({ isVerified: false })
      .where('LOWER(email) = :address', { address })
      .andWhere('is_verified = true')
      .execute();
  } catch (error) {
    // The suppression is the part that protects the sending reputation and it is
    // already written. A failure to clear a badge must not turn the webhook into
    // a 500 and invite a redelivery of an event we have fully recorded.
    logger.warn({ err: error }, 'Could not clear emailVerified after a hard bounce');
  }
}
