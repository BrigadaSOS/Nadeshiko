import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { ApiAuth } from '../models/api/apiAuth';
import { ApiUsageHistory } from '../models/api/apiUsageHistory';
import { User } from '../models/user/user';
import { UserRole } from '../models/user/userRole';
import { Role } from '../models/user/role';
import { hashApiKey } from '../utils/utils';

export const rateLimitApiQuota = async (req: any, res: Response, next: NextFunction) => {
  if (req.apiKey) {
    try {
      const apiAuth = await ApiAuth.findOne({
        where: { token: hashApiKey(req.apiKey), isActive: true },
        include: [
          {
            model: User,
            include: [
              {
                model: UserRole,
                include: [Role],
              },
            ],
          },
        ],
      });

      if (!apiAuth || !apiAuth.user) {
        return res.status(401).json({ message: 'Invalid API Key.' });
      }

      const roles = apiAuth.user.UserRoles.map((ur) => ur.role);
      const maxQuota = Math.max(...roles.map((role) => role.quotaLimit));

      if (maxQuota === -1) {
        await logApiUsage(req, apiAuth);
        next();
        return;
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
        return res.status(429).json({ message: 'API Key quota exceeded for this month.' });
      }

      await logApiUsage(req, apiAuth);
      next();
    } catch (error) {
      console.error('Rate Limit Error:', error);
      next(error);
    }
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
