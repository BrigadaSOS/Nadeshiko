import { ApiAuth, User, UserRole } from '@app/entities';
import {
  AuthCredentialsRequiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsExpiredError,
  AccessDeniedError,
} from '@lib/utils/apiErrors';
import { Response, NextFunction } from 'express';
import { hashApiKey } from '@lib/utils/utils';
import { auth, BETTER_AUTH_SESSION_COOKIE_ALIASES } from '@lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { DEV_IMPERSONATION_COOKIE, getDevImpersonationSession } from '@app/services/devImpersonation';

export const authenticate = (options: { session?: boolean; apiKey?: boolean }) => {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = req.headers['x-api-key'];
    const authToken = req.headers.authorization;
    const hasBearerToken = authToken && authToken.startsWith('Bearer ');
    const hasSessionCookie = BETTER_AUTH_SESSION_COOKIE_ALIASES.some((cookieName) =>
      extractCookieValue(req, cookieName),
    );
    const hasDevCookie = extractCookieValue(req, DEV_IMPERSONATION_COOKIE) !== null;

    if (options.session && (hasSessionCookie || hasDevCookie)) {
      return isAuthSession(req, res, next);
    }

    if (options.apiKey && (apiKey || hasBearerToken)) {
      return isAuthenticatedAPI(req, res, next);
    }

    // No valid authentication provided
    const missing: string[] = [];
    if (options.session && !hasSessionCookie && !hasDevCookie) missing.push('Session');
    if (options.apiKey && !apiKey && !hasBearerToken) missing.push('API Key');
    throw new AuthCredentialsRequiredError(`Authentication required: ${missing.join(' or ')}`);
  };
};

export const isAuthSession = async (req: any, _res: Response, next: NextFunction): Promise<void> => {
  const isNonProduction = process.env.ENVIRONMENT !== 'production';
  const devToken = extractCookieValue(req, DEV_IMPERSONATION_COOKIE);

  if (isNonProduction && devToken) {
    const devSession = getDevImpersonationSession(devToken);
    if (!devSession) {
      throw new AuthCredentialsExpiredError('Development impersonation session has expired.');
    }
    await attachJwtPayloadToRequest(req, devSession.userId, 'dev-impersonation');
    next();
    return;
  }

  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!sessionData?.user?.id) {
      throw new AuthCredentialsRequiredError('Session token missing.');
    }

    const userId = Number(sessionData.user.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AuthCredentialsInvalidError('Invalid session user id.');
    }

    await attachJwtPayloadToRequest(req, userId, 'session');
    next();
  } catch (error) {
    if (
      error instanceof AuthCredentialsRequiredError ||
      error instanceof AuthCredentialsExpiredError ||
      error instanceof AuthCredentialsInvalidError
    ) {
      throw error;
    }
    throw new AuthCredentialsInvalidError('Invalid or expired session.');
  }
};

function extractCookieValue(req: any, cookieName: string): string | null {
  const cookies: string | undefined = req.headers['cookie'];
  if (!cookies) return null;
  for (const cookie of cookies.split(';')) {
    const [name, value] = cookie.split('=').map((c) => c.trim());
    if (name === cookieName) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

async function attachJwtPayloadToRequest(
  req: any,
  userId: number,
  authType: 'session' | 'dev-impersonation',
): Promise<void> {
  const user = await User.findOne({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  const userRoles = await UserRole.find({ where: { userId } });
  req.jwt = {
    user_id: userId,
    roles: userRoles.map((userRole) => userRole.roleId),
  };
  req.auth = {
    type: authType,
    user_id: userId,
  };
}

async function isAuthenticatedAPI(req: any, _res: Response, next: NextFunction): Promise<void> {
  // Extract API key from Authorization: Bearer <token> header (preferred) or X-API-Key header (fallback)
  let apiKey: string | undefined;

  // Try Authorization: Bearer <token> first
  if (req.headers.authorization) {
    const authHeader = req.headers.authorization as string;
    if (authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix
    }
  }

  // Fall back to X-API-Key header
  if (!apiKey) {
    apiKey = req.headers['x-api-key'] as string | undefined;
  }

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
