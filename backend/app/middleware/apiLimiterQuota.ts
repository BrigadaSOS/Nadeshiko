import { Response, NextFunction } from 'express';
import { AuthCredentialsInvalidError, QuotaExceededError } from '@lib/utils/apiErrors';
import { incrementAndGetUserQuota } from '@app/services/accountQuota';

export const rateLimitApiQuota = async (req: any, _res: Response, next: NextFunction): Promise<void> => {
  if (req._accountQuotaApplied === true) {
    next();
    return;
  }

  req._accountQuotaApplied = true;

  if (!req.apiKey || !req.auth?.type?.startsWith('api-key')) {
    next();
    return;
  }

  if (req.auth?.apiKeyKind === 'service') {
    next();
    return;
  }

  const userId = Number(req.auth?.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AuthCredentialsInvalidError('Invalid API key owner.');
  }

  const quota = await incrementAndGetUserQuota(userId);
  req.accountQuota = quota;

  if (quota.quotaUsed > quota.quotaLimit) {
    throw new QuotaExceededError(
      `Monthly quota exceeded: used ${quota.quotaUsed} of ${quota.quotaLimit} requests for this account.`,
    );
  }

  next();
};
