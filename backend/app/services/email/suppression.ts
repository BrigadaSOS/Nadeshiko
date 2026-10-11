import { MoreThan } from 'typeorm';
import { EmailEvent, EmailSuppression, SUPPRESSION_CAUSES } from '@app/models';
import type { SuppressionCause } from '@app/models';
import { logger } from '@config/log';
import { registerSuppressionGauge } from './metrics';

/** Require repeated soft bounces within the rolling window; a single transient refusal must not suppress an address. */
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

/** Suppress idempotently without overwriting the first cause; later events must not turn a permanent complaint into
 * a recoverable state. */
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

/** Count the rolling event window from the log instead of a resettable address counter. */
export async function softBouncedTooOften(address: string): Promise<number> {
  const since = new Date(Date.now() - SOFT_BOUNCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return EmailEvent.countBy({
    address,
    event: 'soft_bounce',
    occurredAt: MoreThan(since),
  });
}

/** Remove the application row and lift the provider row separately; clearing only one half leaves the address
 * effectively suppressed. */
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
