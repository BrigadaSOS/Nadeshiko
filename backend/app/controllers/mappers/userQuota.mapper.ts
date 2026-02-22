import type { t_UserQuotaResponse } from 'generated/models';
import type { AccountQuotaSnapshot } from '@app/models/AccountQuotaUsage';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';

export const toUserQuotaDTO = (snapshot: AccountQuotaSnapshot): t_UserQuotaResponse => {
  const { periodStart, periodEnd } = AccountQuotaUsage.getQuotaWindow(snapshot.periodYyyymm);

  return {
    quotaUsed: snapshot.quotaUsed,
    quotaLimit: snapshot.quotaLimit,
    quotaRemaining: snapshot.quotaRemaining,
    periodYyyymm: snapshot.periodYyyymm,
    periodStart,
    periodEnd,
  };
};
