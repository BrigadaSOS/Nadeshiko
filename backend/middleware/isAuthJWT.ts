import { Authorized, BadRequest } from '../utils/error';
import { Response, NextFunction, Request } from 'express';
var jwt = require('jsonwebtoken');

export const ADMIN = 1;
export const MOD = 2;
export const USER = 3;

export const isAuthJWT = (req: Request, _: Response, next: NextFunction): void => {
  const token = extractTokenFromCookie(req);

  if (!token) {
    return next(new Authorized('No hay token...'));
  }

  try {
    const jwtSecretKey: string = getJwtSecretKey();
    const decoded: any = jwt.verify(token, jwtSecretKey);

    req.jwt = decoded;

    next();
  } catch (error) {
    handleError(error, next);
  }
};

export const requireRole = (...allowedRoles: number[]) => {
  return (req: Request, _: Response, next: NextFunction): void => {
    const roles: number[] = req.jwt.roles;
    console.log(roles)
    console.log(allowedRoles)
    if (!roles.some(role => allowedRoles.includes(role))) {
      return next(new Authorized('Acceso denegado. No autorizado...'));
    }

    next();
  };
};

function extractTokenFromCookie(req: Request): string | null {
  const authHeader: string | undefined = req.headers['cookie'];
  return authHeader ? authHeader.split('=')[1] : null;
}

function getJwtSecretKey(): string {
  if (!process.env.SECRET_KEY_JWT) {
    throw new Error('JWT Secret Key no definido en las variables de entorno.');
  }
  return process.env.SECRET_KEY_JWT;
}

function handleError(error: any, next: NextFunction): void {
  if (error.message === 'jwt expired') {
    return next(new BadRequest('El token JWT ha expirado.'));
  }
  next(new Authorized('Token inválido...'));
}
