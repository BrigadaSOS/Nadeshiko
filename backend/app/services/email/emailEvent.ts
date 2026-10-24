import { EmailEvent, User } from '@app/models';
import { logger } from '@config/log';
import { softBouncedTooOften, suppress, SOFT_BOUNCE_THRESHOLD } from './suppression';

/** Provider-neutral half of delivery events: the idempotent insert and the suppression rules. Provider parsers turn
 * their payloads into `recordOne` calls and apply consequences only for the insert that wins. */

type Json = Record<string, unknown>;

export async function recordOne(fields: {
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
export async function applyEvent(event: EmailEvent): Promise<void> {
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
