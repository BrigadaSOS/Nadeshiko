import { Response, NextFunction } from 'express';
import { Forbidden } from '../utils/error';

export const hasPermissionAPI = (permissions: string[]) => {
  return async (req: any, _res: Response, next: NextFunction): Promise<void> => {
    // We check for permission if API key is used
    if (req.user) {
      const userPermissions = req.user.apiAuth.permissions.map((permission: { name: string }) => permission.name);

      // Check if at least one of the required permissions is in userPermissions
      const missingPermissions = permissions.filter((permission) => !userPermissions.includes(permission));

      if (missingPermissions.length > 0) {
        // Create a string with the missing permissions for the error message
        const missingPermissionsString = missingPermissions.join(', ');

        throw new Forbidden(`Access forbidden: missing the following permissions: ${missingPermissionsString}.`);
      }
      return next();
    }
    // Otherwise, we skip permission verification
    return next();
  };
};
