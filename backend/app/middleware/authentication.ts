import { ApiAuth, User } from '@app/entities';
import {
  AuthCredentialsRequiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsExpiredError,
  AccessDeniedError,
  InternalServerError,
} from '@lib/utils/apiErrors';
import { Response, NextFunction } from 'express';
import { hashApiKey } from '@lib/utils/utils';
import { parse } from 'url';

import jwt from 'jsonwebtoken';
export const maxAgeJWT: number = 3 * 24 * 60 * 60; // 3 days

export const authenticate = (options: { jwt?: boolean; apiKey?: boolean }) => {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'];
    const authToken = req.headers.authorization;
    const allowedUrls = process.env.ALLOWED_WEBSITE_URLS?.split(',');

    if (!allowedUrls) {
      throw new InternalServerError('No allowed URLs specified in the environment file.');
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

    // Determine if request is from unknown source (not SSR, not in allowed URLs)
    const isUnknownSource = !requestFromAllowedUrl;

    if (isUnknownSource) {
      // Unknown source - require explicit authentication
      const hasBearerToken = authToken && authToken.startsWith('Bearer ');
      const hasJwtCookie = extractTokenFromCookie(req) !== null;

      if (options.jwt && (hasBearerToken || hasJwtCookie)) {
        return isAuthJWT(req, res, next);
      }

      if (options.apiKey !== false && apiKey) {
        return isAuthenticatedAPI(req, res, next);
      }

      // No valid authentication provided
      const missing: string[] = [];
      if (options.jwt && !hasBearerToken && !hasJwtCookie) missing.push('JWT Token');
      if (options.apiKey && !apiKey) missing.push('API Key');
      throw new AuthCredentialsRequiredError(`Authentication required: ${missing.join(' or ')}`);
    }

    // Known source or SSR request
    if (options.jwt) {
      return isAuthJWT(req, res, next);
    }
    next();
  };
};

export const isAuthJWT = (req: any, _res: Response, next: NextFunction): void => {
  const token = extractTokenFromCookie(req);

  if (!token) {
    throw new AuthCredentialsRequiredError('JWT token missing');
  }

  try {
    const jwtSecretKey: string = getJwtSecretKey();
    const decoded: any = jwt.verify(token, jwtSecretKey);

    req.jwt = decoded;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthCredentialsExpiredError('JWT token has expired.');
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthCredentialsInvalidError('Invalid JWT token.');
    }
    throw new AuthCredentialsInvalidError('Invalid token...');
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
    throw new AuthCredentialsRequiredError('No API key was provided.');
  }

  const hashedKey = hashApiKey(apiKey);

  const apiAuth = await ApiAuth.findOne({
    where: { token: hashedKey },
  });

  if (!apiAuth) {
    throw new AuthCredentialsInvalidError('Invalid API key.');
  }

  if (!apiAuth.isActive) {
    throw new AuthCredentialsExpiredError('API key has been deactivated.');
  }

  const user = await User.findOne({
    relations: {
      apiAuth: {
        permissions: true,
      },
    },
    where: {
      apiAuth: {
        token: hashedKey,
        isActive: true,
      },
    },
  });

  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid API key.');
  }

  req.user = user;
  next();
}

export const requireRoleJWT = (...allowedRoles: number[]) => {
  return (req: any, _res: Response, next: NextFunction): void => {
    const roles: number[] = req.jwt.roles;
    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw new AccessDeniedError('Denied access. Not authorized.');
    }
    next();
  };
};

export const createToken = (id: number, role: any[]): string => {
  const jwtSecretKey: string = (process.env.SECRET_KEY_JWT as string) || '';
  return jwt.sign({ user_id: id, roles: role }, jwtSecretKey, { algorithm: 'HS256', expiresIn: maxAgeJWT });
};
