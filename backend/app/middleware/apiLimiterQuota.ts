import type { Request, Response, NextFunction } from 'express';
import { AuthCredentialsInvalidError, QuotaExceededError } from '@app/errors';
import { ApiKeyKind, AuthType } from '@app/models';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { logger } from '@config/log';

export const rateLimitApiQuota = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.auth?.type !== AuthType.API_KEY) {
    next();
    return;
  }

  if (req.auth.apiKey?.kind === ApiKeyKind.SERVICE) {
    next();
    return;
  }

  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid API key owner.');
  }

  const quota = await AccountQuotaUsage.getForUser(user.id, user.monthlyQuotaLimit);
  req.accountQuota = quota;

  if (quota.quotaUsed >= quota.quotaLimit) {
    throw new QuotaExceededError(
      `Monthly quota exceeded: used ${quota.quotaUsed} of ${quota.quotaLimit} requests for this account.`,
    );
  }

  res.on('finish', () => {
    logger.debug({ userId: user.id, statusCode: res.statusCode }, 'API quota finish callback fired');
    if (res.statusCode >= 200 && res.statusCode < 300) {
      AccountQuotaUsage.incrementForUser(user.id)
        .then(() => {
          logger.debug({ userId: user.id }, 'Account quota incremented successfully');
        })
        .catch((err: unknown) => {
          logger.warn({ err, userId: user.id }, 'Failed to increment account quota usage');
        });
    }
  });

  next();
};
