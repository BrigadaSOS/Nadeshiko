import type { t_UserMe } from 'generated/models';
import type { User } from '@app/models/User';
import type { Tier } from '@app/models/Tier';
import type { AccountQuotaSnapshot } from '@app/models/AccountQuotaUsage';

export const toUserMeDTO = (
  user: User,
  quota: AccountQuotaSnapshot,
  window: { periodStart: string; periodEnd: string },
  tier: Tier | null,
  burst: { max: number; windowMs: number },
): t_UserMe => ({
  user: {
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  },
  quota: {
    limit: quota.quotaLimit,
    used: quota.quotaUsed,
    remaining: quota.quotaRemaining,
    periodYyyymm: quota.periodYyyymm,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    // Null when an override is in force: the tier no longer describes this
    // account's limit, and naming it next to a number it does not explain is
    // worse than naming nothing.
    tier: tier ? { id: tier.id, displayName: tier.displayName } : null,
    // The other limit. Sent alongside the month because they are exhausted for
    // different reasons and a page showing only one cannot explain a 429 caused
    // by the other -- the confusion this whole field set exists to end.
    burst,
  },
});
