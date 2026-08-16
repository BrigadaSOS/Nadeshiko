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

/**
 * The monthly request allowance for an account, and what decided it.
 *
 * Order: explicit override, then the tier, then the pre-tier column, then the
 * default. Every step down is a step the account did not ask for, so the last
 * two are logged -- an account that reaches them is one the tier system has
 * lost track of, and the symptom otherwise is a reader quietly getting 5000
 * when they are paying for 100000.
 *
 * `user.tier` has to be PASSED IN for the tier step to apply; this takes it as
 * a separate argument on the object rather than reading a relation, because the
 * hot caller (`apiLimiterQuota`) serves it from a process-wide cache of three
 * rows instead of joining the table on every authenticated request. A caller
 * that omits it gets the legacy column -- the value that was in force for that
 * account before tiers existed, so correct, but stale from the moment somebody
 * changes their tier.
 */
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

  // A tier id that resolved to nothing is the interesting case: either the row
  // was deleted out from under the account, or the caller did not join the
  // relation. Both end up here and both are worth saying out loud, because the
  // account keeps working on a number nobody chose for it.
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
