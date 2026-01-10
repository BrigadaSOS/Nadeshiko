import { ApiAuth } from '../models/api/apiAuth';
import { User } from '../models/user/user';
import { Authorized, BadRequest } from '../utils/error';
import { Response, NextFunction } from 'express';
import { ApiPermission } from '../models/api/apiPermission';
import { ApiAuthPermission } from '../models/api/ApiAuthPermission';
import { hashApiKey } from '../utils/utils';
import { parse } from 'url';
import { logger } from '../utils/log';

import jwt from 'jsonwebtoken';
export const maxAgeJWT: number = 3 * 24 * 60 * 60; // 3 days

export const authenticate = (options: { jwt: boolean; apiKey: boolean }) => {
  return (req: any, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    const authToken = req.headers.authorization;
    const allowedUrls = process.env.ALLOWED_WEBSITE_URLS?.split(',');

    if (!allowedUrls) {
      return res.status(401).json({ error: 'No allowed URLs specified in the environment file.' });
    }

    const requestUrl = parse(req.headers.referer || '');
    const userAgent = req.headers['user-agent'] || '';
    const isSSRRequest = userAgent.includes('node') || userAgent.includes('nuxt');

    if (isSSRRequest) {
      return next();
    }

    const requestFromAllowedUrl = allowedUrls.some((url) => {
      const parsedUrl = parse(url);
      return parsedUrl.host === requestUrl.host && parsedUrl.protocol === requestUrl.protocol;
    });

    // If petition comes from an unknown source, we must verify API Key or JWT
    if (!requestFromAllowedUrl) {
      if (options.jwt && authToken && authToken.startsWith('Bearer ')) {
        return isAuthJWT(req, res, next);
      } else if (options.apiKey && apiKey) {
        return isAuthenticatedAPI(req, res, next);
      } else {
        const missing = [];
        if (options.jwt) missing.push('JWT');
        if (options.apiKey) missing.push('API Key');
        res.status(401).json({ error: `Authentication required: ${missing.join(' or ')}` });
      }
    } else {
      // Otherwise, skip authentication except for JWT
      if (options.jwt) {
        return isAuthJWT(req, res, next);
      } else {
        next();
      }
    }
  };
};

export const isAuthJWT = (req: any, _: Response, next: NextFunction): void => {
  const token = extractTokenFromCookie(req);

  try {
    const jwtSecretKey: string = getJwtSecretKey();
    const decoded: any = jwt.verify(token, jwtSecretKey);

    req.jwt = decoded;

    next();
  } catch (error) {
    handleErrorJWT(error, next);
  }
};

function extractTokenFromCookie(req: any): string | null {
  const cookies: string | undefined = req.headers['cookie'];
  if (!cookies) return null;
  const cookieArray = cookies.split(';');
  for (const cookie of cookieArray) {
    const [name, value] = cookie.split('=').map((c) => c.trim());
    if (name === 'access_token') {
      return value;
    }
  }
  return null;
}

function getJwtSecretKey(): string {
  if (!process.env.SECRET_KEY_JWT) {
    throw new Error('JWT Secret Key no definido en las variables de entorno.');
  }
  return process.env.SECRET_KEY_JWT;
}

function handleErrorJWT(error: any, next: NextFunction): void {
  if (error instanceof jwt.TokenExpiredError) {
    return next(new Authorized('El token JWT ha expirado.'));
  } else if (error instanceof jwt.JsonWebTokenError) {
    return next(new Authorized('Token JWT inválido.'));
  }
  next(new Authorized('Token inválido...'));
}

async function isAuthenticatedAPI(req: any, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];
  req.apiKey = apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'No API key was provided.' });
  }

  const hashedKey = hashApiKey(apiKey);

  try {
    const user = await User.findOne({
      include: [
        {
          model: ApiAuth,
          where: { token: hashedKey },
          include: [
            {
              model: ApiPermission,
              through: ApiAuthPermission as any,
            },
          ],
        },
      ],
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid API key.' });
    } else {
      if (!req.user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    logger.error({ err: error, apiKeyPresent: !!apiKey }, 'Authentication error');
    next(new BadRequest('There was an error. Please try again later...'));
  }
}

export const requireRoleJWT = (...allowedRoles: number[]) => {
  return (req: any, _: Response, next: NextFunction): void => {
    const roles: number[] = req.jwt.roles;
    if (!roles.some((role) => allowedRoles.includes(role))) {
      return next(new Authorized('Denied access. Not authorized.'));
    }
    next();
  };
};

export const createToken = (id: number, role: any[]): string => {
  const jwtSecretKey: string = (process.env.SECRET_KEY_JWT as string) || '';
  return jwt.sign({ user_id: id, roles: role }, jwtSecretKey, { algorithm: 'HS256', expiresIn: maxAgeJWT });
};
