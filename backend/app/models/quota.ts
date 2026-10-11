import { logger } from '@config/log';
import { AccountQuotaUsage } from './AccountQuotaUsage';
import type { Tier } from './Tier';
import type { User } from './User';

/** What decided the number, for the log line and the admin surface. */
export type QuotaSource = 'override' | 'tier' | 'legacy_column' | 'default';

export interface ResolvedQuota {
  limit: number;
  source: QuotaSource;
  tierId: string | null;
}

/** Resolve quota in order: override, tier, legacy column, default. Pass the tier explicitly so the hot caller can
 * use its small cache. */
export function resolveQuotaLimit(
  user: Pick<User, 'id' | 'quotaOverride' | 'monthlyQuotaLimit' | 'tierId'> & { tier?: Tier | null },
): ResolvedQuota {
  const tierId = user.tierId ?? null;

  if (user.quotaOverride != null && Number.isFinite(user.quotaOverride)) {
    return { limit: user.quotaOverride, source: 'override', tierId };
  }

  const tierLimit = user.tier?.monthlyQuotaLimit;
  if (tierLimit != null && Number.isFinite(tierLimit)) {
    return { limit: tierLimit, source: 'tier', tierId };
  }

  // A missing joined tier falls back and is logged: the account must keep working even when the row was deleted or the
  // caller omitted the relation.
  if (tierId !== null && user.tier === undefined) {
    logger.debug(
      { userId: user.id, tierId },
      'Quota resolved without a loaded tier; falling back to the stored column',
    );
  } else if (tierId !== null) {
    logger.warn({ userId: user.id, tierId }, 'Quota tier is missing from the Tier table; falling back');
  }

  if (Number.isFinite(user.monthlyQuotaLimit)) {
    return { limit: user.monthlyQuotaLimit, source: 'legacy_column', tierId };
  }

  logger.warn({ userId: user.id, tierId }, 'Quota fell through to the built-in default');
  return { limit: AccountQuotaUsage.DEFAULT_QUOTA_LIMIT, source: 'default', tierId };
}
