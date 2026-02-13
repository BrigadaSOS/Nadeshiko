import { ApiPermission } from '@app/models/ApiPermission';
import { InsufficientPermissionsError } from '@app/errors';
import { Request, Response, NextFunction } from 'express';

export const requirePermissions = (...requiredPermissions: ApiPermission[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userPermissions = req.auth?.apiKey?.permissions ?? [];

    const missingPermissions = requiredPermissions.filter((p) => !userPermissions.includes(p));
    if (missingPermissions.length > 0) {
      throw new InsufficientPermissionsError(
        `Access forbidden: missing the following permissions: ${missingPermissions.join(', ')}.`,
      );
    }

    next();
  };
};
