import type { RequestHandler } from 'express';
import { requireApiKeyAuth, requireSessionAuth } from '@app/middleware/authentication';
import { AuthType, ApiPermission } from '@app/models/ApiPermission';
import { requirePermissions } from '@app/middleware/authorization';
import { rateLimitApiQuota } from '@app/middleware/apiLimiterQuota';
import { InsufficientPermissionsError } from '@app/errors';

export const apiKeyOnly = [requireApiKeyAuth, rateLimitApiQuota] as const;
export const searchAccess = [
  requireApiKeyAuth,
  requirePermissions(ApiPermission.READ_MEDIA),
  rateLimitApiQuota,
] as const;

export const mediaReadPermission = [requirePermissions(ApiPermission.READ_MEDIA)] as const;
export const mediaAddPermission = [requirePermissions(ApiPermission.ADD_MEDIA)] as const;
export const mediaUpdatePermission = [requirePermissions(ApiPermission.UPDATE_MEDIA)] as const;
export const mediaRemovePermission = [requirePermissions(ApiPermission.REMOVE_MEDIA)] as const;

export const requireApiKeyOrSession: RequestHandler = async (req, res, next) => {
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  if (hasBearer) {
    await requireApiKeyAuth(req, res, next);
    return;
  }
  await requireSessionAuth(req, res, next);
};

export const enforceAdminAccess: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') {
    throw new InsufficientPermissionsError('Admin access required.');
  }

  next();
};

export const enforceAdminOrMediaUpdateAccess: RequestHandler = (req, res, next) => {
  if (req.auth?.type === AuthType.SESSION) {
    if (req.user?.role !== 'ADMIN') {
      throw new InsufficientPermissionsError('Admin access required.');
    }
    next();
    return;
  }

  const permissionsMiddleware = requirePermissions(ApiPermission.UPDATE_MEDIA);
  permissionsMiddleware(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    next();
  });
};
