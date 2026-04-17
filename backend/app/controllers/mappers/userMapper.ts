import type { t_UserMe } from 'generated/models';
import type { User } from '@app/models/User';
import type { AccountQuotaSnapshot } from '@app/models/AccountQuotaUsage';

export const toUserMeDTO = (
  user: User,
  quota: AccountQuotaSnapshot,
  window: { periodStart: string; periodEnd: string },
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
  },
});
