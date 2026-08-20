import { MoreThan } from 'typeorm';
import { EmailEvent, EmailSuppression, SUPPRESSION_CAUSES } from '@app/models';
import type { SuppressionCause } from '@app/models';
import { logger } from '@config/log';
import { registerSuppressionGauge } from './metrics';

/**
 * A soft bounce is not a verdict on its own, so a threshold is what turns a run
 * of them into one. Five inside a week: a genuinely full mailbox clears long
 * before that, and a server that has been refusing us for seven days is not
 * having a bad afternoon.
 */
export const SOFT_BOUNCE_THRESHOLD = 5;
export const SOFT_BOUNCE_WINDOW_DAYS = 7;

/**
 * Addresses are compared, stored, and deduplicated in one shape so the unique
 * index is a real guarantee rather than a case-sensitive near-miss.
 */
export function normalizeAddress(address: string | null | undefined): string | null {
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export async function isSuppressed(address: string | null | undefined): Promise<boolean> {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;

  return EmailSuppression.existsBy({ address: normalized });
}

/**
 * Idempotent, and DELIBERATELY DOES NOT OVERWRITE an existing row: the FIRST
 * cause is the true one. A hard bounce followed by a complaint is still an
 * address that does not exist, and rewriting the cause would turn a permanent
 * complaint into something a future lift treats as recoverable.
 *
 * Returns the row whether it was created now or already stood, so a caller can
 * report either without a second query.
 */
export async function suppress(params: {
  address: string;
  cause: SuppressionCause;
  reason?: string | null;
}): Promise<EmailSuppression | null> {
  const address = normalizeAddress(params.address);
  if (!address) return null;

  const existing = await EmailSuppression.findOneBy({ address });
  if (existing) return existing;

  try {
    const row = EmailSuppression.create({
      address,
      cause: params.cause,
      reason: params.reason ?? null,
      suppressedAt: new Date(),
    });
    await row.save();
    logger.info({ 'email.cause': params.cause }, 'Suppressed an address');
    return row;
  } catch (error) {
    // Two webhook deliveries racing each other on the same address. The other one
    // won and its cause is the first one, which is the answer we wanted anyway.
    const existingAfterRace = await EmailSuppression.findOneBy({ address });
    if (existingAfterRace) return existingAfterRace;
    throw error;
  }
}

/**
 * Has this address soft-bounced often enough that we stop calling it temporary?
 *
 * Counted over the events table rather than a running tally on the address,
 * because the window is rolling: a counter would need resetting on a schedule
 * nobody would remember to run, and the log already holds the answer.
 */
export async function softBouncedTooOften(address: string): Promise<number> {
  const since = new Date(Date.now() - SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return EmailEvent.countBy({
    address,
    event: 'soft_bounce',
    occurredAt: MoreThan(since),
  });
}

/**
 * Remove OUR row. The provider's own list is a separate half, lifted by
 * `liftSuppression` in `zeptomailApi.ts` -- see the note there about why doing
 * only one of the two is worse than doing neither.
 */
export async function removeSuppression(address: string): Promise<EmailSuppression | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  const row = await EmailSuppression.findOneBy({ address: normalized });
  if (!row) return null;

  await EmailSuppression.delete({ address: normalized });
  return row;
}

export async function countSuppressionsByCause(): Promise<Record<string, number>> {
  const rows = await EmailSuppression.createQueryBuilder('s')
    .select('s.cause', 'cause')
    .addSelect('COUNT(*)', 'count')
    .groupBy('s.cause')
    .getRawMany<{ cause: string; count: string }>();

  const counts: Record<string, number> = {};
  for (const cause of SUPPRESSION_CAUSES) counts[cause] = 0;
  for (const row of rows) counts[row.cause] = Number(row.count);
  return counts;
}

/** Wired from the email initializer at boot. */
export function registerSuppressionMetrics(): void {
  registerSuppressionGauge(countSuppressionsByCause);
}
