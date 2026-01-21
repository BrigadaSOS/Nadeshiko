import { ApiAuth } from '../models/api/apiAuth';
import { User } from '../models/user/user';
import { Unauthorized } from '../utils/error';
import { Response, NextFunction } from 'express';
import { ApiPermission } from '../models/api/apiPermission';
import { hashApiKey } from '../utils/utils';
import { parse } from 'url';

import jwt from 'jsonwebtoken';
export const maxAgeJWT: number = 3 * 24 * 60 * 60; // 3 days

export const authenticate = (options: { jwt?: boolean; apiKey?: boolean }) => {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'];
    const authToken = req.headers.authorization;
    const allowedUrls = process.env.ALLOWED_WEBSITE_URLS?.split(',');

    if (!allowedUrls) {
      throw new Unauthorized('No allowed URLs specified in the environment file.');
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
      } else if (options.apiKey !== false && apiKey) {
        return isAuthenticatedAPI(req, res, next);
      } else {
        const missing = [];
        if (options.jwt) missing.push('JWT');
        if (options.apiKey) missing.push('API Key');
        throw new Unauthorized(`Authentication required: ${missing.join(' or ')}`);
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

export const isAuthJWT = (req: any, _res: Response, next: NextFunction): void => {
  const token = extractTokenFromCookie(req);

  if (!token) {
    throw new Unauthorized('JWT token missing');
  }

  try {
    const jwtSecretKey: string = getJwtSecretKey();
    const decoded: any = jwt.verify(token, jwtSecretKey);

    req.jwt = decoded;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Unauthorized('JWT token has expired.');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new Unauthorized('Invalid JWT token.');
    }
    throw new Unauthorized('Invalid token...');
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
    throw new Error('JWT Secret Key not defined in environment variables.');
  }
  return process.env.SECRET_KEY_JWT;
}

async function isAuthenticatedAPI(req: any, _res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  req.apiKey = apiKey;

  if (!apiKey) {
    throw new Unauthorized('No API key was provided.');
  }

  const hashedKey = hashApiKey(apiKey);

  const user = await User.findOne({
    include: [
      {
        model: ApiAuth,
        as: 'apiAuth',
        where: { token: hashedKey },
        include: [
          {
            model: ApiPermission,
            as: 'permissions',
          },
        ],
      },
    ],
  });

  if (!user) {
    throw new Unauthorized('Invalid API key.');
  }

  req.user = user;
  next();
}

export const requireRoleJWT = (...allowedRoles: number[]) => {
  return (req: any, _res: Response, next: NextFunction): void => {
    const roles: number[] = req.jwt.roles;
    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw new Unauthorized('Denied access. Not authorized.');
    }
    next();
  };
};

export const createToken = (id: number, role: any[]): string => {
  const jwtSecretKey: string = (process.env.SECRET_KEY_JWT as string) || '';
  return jwt.sign({ user_id: id, roles: role }, jwtSecretKey, { algorithm: 'HS256', expiresIn: maxAgeJWT });
};
