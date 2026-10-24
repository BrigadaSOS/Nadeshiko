import { ApiPermission, AuthType } from '@app/models/ApiPermission';
import { UserRoleType } from '@app/models/User';
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

/** Admin overrides in handlers are for people at a browser: an API key, even one an admin owns, is a bearer credential
 * that may sit in a third-party tool, so it gets owner-level access only. */
export function isSessionAdmin(req: Pick<Request, 'auth' | 'user'>): boolean {
  return req.auth?.type === AuthType.SESSION && req.user?.role === UserRoleType.ADMIN;
}
