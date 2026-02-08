import { UserRoleType } from '@app/entities';
import { AccessDeniedError, InsufficientPermissionsError } from '@lib/utils/apiErrors';
import { Request, Response, NextFunction } from 'express';

export const requirePermissions = (...requiredPermissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userPermissions = Array.isArray(req.apiKeyPermissions) ? req.apiKeyPermissions : [];

    // Preserve current behavior: empty permission set means unrestricted key.
    if (userPermissions.length > 0) {
      const missingPermissions = requiredPermissions.filter((permission) => !userPermissions.includes(permission));
      if (missingPermissions.length > 0) {
        throw new InsufficientPermissionsError(
          `Access forbidden: missing the following permissions: ${missingPermissions.join(', ')}.`,
        );
      }
    }

    next();
  };
};

export const requireRole = (...allowedRoles: UserRoleType[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.jwt?.role;
    if (!role || !allowedRoles.includes(role)) {
      throw new AccessDeniedError('Denied access. Not authorized.');
    }

    next();
  };
};
