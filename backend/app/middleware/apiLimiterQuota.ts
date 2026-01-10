import { Response, NextFunction } from 'express';
import { ApiAuth } from '@app/entities';
import { hashApiKey } from '@lib/utils/utils';
import { AuthCredentialsInvalidError } from '@lib/utils/apiErrors';

export const rateLimitApiQuota = async (req: any, _res: Response, next: NextFunction): Promise<void> => {
  if (req.apiKey) {
    const apiAuth = await ApiAuth.findOne({
      where: { token: hashApiKey(req.apiKey), isActive: true },
      relations: {
        user: {
          userRoles: {
            role: true,
          },
        },
      },
    });

    if (!apiAuth || !apiAuth.user) {
      throw new AuthCredentialsInvalidError('Invalid API Key.');
    }

    const roles = (apiAuth.user?.userRoles ?? []).map((ur: any) => ur.role);
    const maxQuota = Math.max(...roles.map((role: any) => role?.quotaLimit ?? 0));

    if (maxQuota === -1) {
      return next();
    }

    // TODO: Implement quota tracking once ApiUsageHistory table is added to the database
    // For now, all non-unlimited users pass through
    next();
  } else {
    next();
  }
};
