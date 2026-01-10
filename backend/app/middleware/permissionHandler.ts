import { Response, NextFunction } from 'express';
import { InsufficientPermissionsError } from '@lib/utils/apiErrors';

export const hasPermissionAPI = (permissions: string[]) => {
  return async (req: any, _res: Response, next: NextFunction): Promise<void> => {
    // We check for permission if API key is used
    if (req.user) {
      const userPermissions = req.user.apiAuth.permissions.map(
        (permission: { apiPermission: string }) => permission.apiPermission,
      );

      // Check if at least one of the required permissions is in userPermissions
      const missingPermissions = permissions.filter((permission) => !userPermissions.includes(permission));

      if (missingPermissions.length > 0) {
        // Create a string with the missing permissions for the error message
        const missingPermissionsString = missingPermissions.join(', ');

        throw new InsufficientPermissionsError(
          `Access forbidden: missing the following permissions: ${missingPermissionsString}.`,
        );
      }
      return next();
    }
    // Otherwise, we skip permission verification
    return next();
  };
};
