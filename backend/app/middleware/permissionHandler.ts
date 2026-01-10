import { Response, NextFunction } from 'express';
import { InsufficientPermissionsError } from '@lib/utils/apiErrors';

export const hasPermissionAPI = (permissions: string[]) => {
  return async (req: any, _res: Response, next: NextFunction): Promise<void> => {
    const userPermissions: string[] = Array.isArray(req.apiKeyPermissions)
      ? req.apiKeyPermissions
      : (req.user?.apiAuth?.permissions?.map((permission: { apiPermission: string }) => permission.apiPermission) ??
        []);

    if (userPermissions.length > 0) {
      const missingPermissions = permissions.filter((permission) => !userPermissions.includes(permission));
      if (missingPermissions.length > 0) {
        throw new InsufficientPermissionsError(
          `Access forbidden: missing the following permissions: ${missingPermissions.join(', ')}.`,
        );
      }
    }

    return next();
  };
};
