import { Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ApiAuth } from '../models/api/apiAuth';
import { ApiUsageHistory } from '../models/api/apiUsageHistory';
import { User } from '../models/user/user';
import { UserRole } from '../models/user/userRole';
import { Role } from '../models/user/role';
import { hashApiKey } from '../utils/utils';
import { Unauthorized, TooManyRequests } from '../utils/error';

export const rateLimitApiQuota = async (req: any, _res: Response, next: NextFunction): Promise<void> => {
  if (req.apiKey) {
    const apiAuth = await ApiAuth.findOne({
      where: { token: hashApiKey(req.apiKey), isActive: true },
      include: [
        {
          model: User,
          as: 'user',
          include: [
            {
              model: UserRole,
              as: 'userRoles',
              include: [
                {
                  model: Role,
                  as: 'role',
                },
              ],
            },
          ],
        },
      ],
    });

    if (!apiAuth || !apiAuth.user) {
      throw new Unauthorized('Invalid API Key.');
    }

    const roles = (apiAuth.user?.userRoles ?? []).map((ur: any) => ur.role);
    const maxQuota = Math.max(...roles.map((role: any) => role.quotaLimit));

    if (maxQuota === -1) {
      await logApiUsage(req, apiAuth);
      return next();
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usageCount = await ApiUsageHistory.count({
      where: {
        apiAuthId: apiAuth.id,
        used_at: {
          [Op.gte]: startOfMonth,
        },
      },
    });

    if (usageCount >= maxQuota) {
      throw new TooManyRequests('API Key quota exceeded for this month.');
    }

    await logApiUsage(req, apiAuth);
    next();
  } else {
    next();
  }
};

async function logApiUsage(req: any, apiAuth: any) {
  await ApiUsageHistory.create({
    apiAuthId: apiAuth.id,
    user_id: apiAuth.userId,
    used_at: new Date(),
    request: JSON.stringify(req.body),
    endpoint: req.path,
    method: req.method,
    responseStatus: req.statusCode,
    ipAddress: req.ip,
  });
}
