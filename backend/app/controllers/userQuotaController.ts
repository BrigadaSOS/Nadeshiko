import { Request, Response } from 'express';
import { AuthCredentialsInvalidError } from '@lib/utils/apiErrors';
import { getUserQuota, getQuotaWindow } from '@app/services/accountQuota';

export const getCurrentUserQuota = async (req: Request, res: Response): Promise<void> => {
  const userId = Number(req.auth?.user_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AuthCredentialsInvalidError('Invalid session user.');
  }

  const quota = await getUserQuota(userId);
  const window = getQuotaWindow(quota.periodYyyymm);

  res.status(200).json({
    quotaUsed: quota.quotaUsed,
    quotaLimit: quota.quotaLimit,
    quotaRemaining: quota.quotaRemaining,
    periodYyyymm: quota.periodYyyymm,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
  });
};
