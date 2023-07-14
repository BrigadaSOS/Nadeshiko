import { Authorized, BadRequest } from "../utils/error";
import { Response, NextFunction, request } from "express";

export const hasPermission = (permissions: string[]) => {
  return async (req: any, res: Response, next: NextFunction) => {
    if (req.user) {
      const userPermissions = req.user.apiAuth.permissions.map(
        (permission: { name: string }) => permission.name
      );

      console.log(userPermissions);

      // Comprueba si al menos uno de los permisos requeridos está en userPermissions
      const missingPermissions = permissions.filter(
        (permission) => !userPermissions.includes(permission)
      );

      if (missingPermissions.length > 0) {
        // Crear una cadena con los permisos que faltan para el mensaje de error
        const missingPermissionsString = missingPermissions.join(", ");

        return res.status(403).json({
          error: `Access forbidden: missing the following permissions: ${missingPermissionsString}.`,
        });
      }
      return next();
    }
    return next();
  };
};
