import type { GetUserQuota } from 'generated/routes/user';
import { AuthCredentialsInvalidError } from '@app/errors';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

export const getUserQuota: GetUserQuota = async (_params, respond, req) => {
  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const quota = await AccountQuotaUsage.getForUser(user.id, Number(user.monthlyQuotaLimit));
  const window = AccountQuotaUsage.getQuotaWindow(quota.periodYyyymm);

  return respond.with200().body({
    quotaUsed: quota.quotaUsed,
    quotaLimit: quota.quotaLimit,
    quotaRemaining: quota.quotaRemaining,
    periodYyyymm: quota.periodYyyymm,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
  });
};
