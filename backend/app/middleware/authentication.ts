import { ApiAuth, User, UserRole } from '@app/entities';
import {
  AccessDeniedError,
  AuthCredentialsExpiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsRequiredError,
} from '@lib/utils/apiErrors';
import { Response, NextFunction } from 'express';
import { hashApiKey } from '@lib/utils/utils';
import { auth, BETTER_AUTH_SESSION_COOKIE_ALIASES } from '@lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { DEV_IMPERSONATION_COOKIE, getDevImpersonationSession } from '@app/services/devImpersonation';

type RequestAuthType = 'session' | 'dev-impersonation' | 'api-key-better-auth' | 'api-key-legacy';

const LEGACY_API_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_MASTER_API_KEY = process.env.API_KEY_MASTER?.trim();

export const authenticate = (options: { session?: boolean; apiKey?: boolean }) => {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    const hasBearerToken = extractBearerToken(req) !== undefined;
    const hasSessionCookie = BETTER_AUTH_SESSION_COOKIE_ALIASES.some((cookieName) =>
      extractCookieValue(req, cookieName),
    );
    const hasDevCookie = extractCookieValue(req, DEV_IMPERSONATION_COOKIE) !== null;

    if (options.session && (hasSessionCookie || hasDevCookie)) {
      return isAuthSession(req, res, next);
    }

    if (options.apiKey && hasBearerToken) {
      return isAuthenticatedAPI(req, res, next);
    }

    const missing: string[] = [];
    if (options.session && !hasSessionCookie && !hasDevCookie) missing.push('Session');
    if (options.apiKey && !hasBearerToken) missing.push('API Key (Authorization Bearer)');
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

function extractBearerToken(req: any): string | undefined {
  const authorization = req.headers.authorization as string | undefined;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

function looksLikeLegacyApiKey(apiKey: string): boolean {
  return LEGACY_API_KEY_REGEX.test(apiKey);
}

function isLegacyMasterApiKey(apiKey: string): boolean {
  return Boolean(LEGACY_MASTER_API_KEY) && apiKey === LEGACY_MASTER_API_KEY;
}

function flattenBetterAuthPermissions(rawPermissions: unknown): string[] {
  if (!rawPermissions || typeof rawPermissions !== 'object') {
    return [];
  }

  const permissions = Object.values(rawPermissions as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === 'string');

  return Array.from(new Set(permissions));
}

function mapBetterAuthApiKeyError(error: unknown): AuthCredentialsInvalidError | AuthCredentialsExpiredError | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const maybeError = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    body?: {
      code?: unknown;
      message?: unknown;
    };
  };

  const code = typeof maybeError.body?.code === 'string' ? maybeError.body.code : '';

  if (code === 'KEY_DISABLED' || code === 'KEY_EXPIRED' || code === 'USAGE_EXCEEDED') {
    return new AuthCredentialsExpiredError('API key is disabled or expired.');
  }

  if (code === 'INVALID_API_KEY') {
    return new AuthCredentialsInvalidError('Invalid API key.');
  }

  const status = typeof maybeError.status === 'string' ? maybeError.status : '';
  const statusCode = typeof maybeError.statusCode === 'number' ? maybeError.statusCode : -1;
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';
  const bodyMessage = typeof maybeError.body?.message === 'string' ? maybeError.body.message : '';

  if (
    (statusCode === 401 || status === 'UNAUTHORIZED') &&
    /invalid api key/i.test(`${message} ${bodyMessage}`.trim())
  ) {
    return new AuthCredentialsInvalidError('Invalid API key.');
  }

  return null;
}

async function attachJwtPayloadToRequest(req: any, userId: number, authType: RequestAuthType): Promise<void> {
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
  const apiKey = extractBearerToken(req);
  req.apiKey = apiKey;

  if (!apiKey) {
    throw new AuthCredentialsRequiredError('No API key was provided in Authorization header.');
  }

  if (looksLikeLegacyApiKey(apiKey) || isLegacyMasterApiKey(apiKey)) {
    await authenticateLegacyApiKey(req, apiKey);
    next();
    return;
  }

  if (await tryAuthenticateBetterAuthApiKey(req, apiKey)) {
    next();
    return;
  }

  if (await tryAuthenticateLegacyApiKey(req, apiKey)) {
    next();
    return;
  }

  throw new AuthCredentialsInvalidError('Invalid API key.');
}

async function tryAuthenticateBetterAuthApiKey(req: any, apiKey: string): Promise<boolean> {
  try {
    await authenticateBetterAuthApiKey(req, apiKey);
    return true;
  } catch (error) {
    if (error instanceof AuthCredentialsInvalidError || error instanceof AuthCredentialsExpiredError) {
      return false;
    }
    throw error;
  }
}

async function authenticateBetterAuthApiKey(req: any, apiKey: string): Promise<void> {
  let verification: {
    valid?: boolean;
    key?: {
      id?: string;
      userId?: string | number;
      permissions?: unknown;
    } | null;
    error?: {
      code?: string;
      message?: string;
    } | null;
  };

  try {
    verification = (await auth.api.verifyApiKey({
      body: {
        key: apiKey,
      },
    })) as typeof verification;
  } catch (error) {
    const mappedError = mapBetterAuthApiKeyError(error);
    if (mappedError) {
      throw mappedError;
    }
    throw error;
  }

  if (!verification?.valid || !verification.key) {
    const code = verification?.error?.code;
    if (code === 'KEY_DISABLED' || code === 'KEY_EXPIRED' || code === 'USAGE_EXCEEDED') {
      throw new AuthCredentialsExpiredError('API key is disabled or expired.');
    }
    throw new AuthCredentialsInvalidError('Invalid API key.');
  }

  const userId = Number(verification.key.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AuthCredentialsInvalidError('Invalid API key owner.');
  }

  await attachJwtPayloadToRequest(req, userId, 'api-key-better-auth');
  req.user = undefined;
  req.apiKeyPermissions = flattenBetterAuthPermissions(verification.key.permissions);
}

async function tryAuthenticateLegacyApiKey(req: any, apiKey: string): Promise<boolean> {
  try {
    await authenticateLegacyApiKey(req, apiKey);
    return true;
  } catch (error) {
    if (
      error instanceof AuthCredentialsRequiredError ||
      error instanceof AuthCredentialsInvalidError ||
      error instanceof AuthCredentialsExpiredError
    ) {
      return false;
    }
    throw error;
  }
}

async function authenticateLegacyApiKey(req: any, apiKey: string): Promise<void> {
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

  await attachJwtPayloadToRequest(req, user.id, 'api-key-legacy');
  req.user = user;
  req.apiKeyPermissions = (user.apiAuth?.permissions ?? []).map(
    (permission: { apiPermission: string }) => permission.apiPermission,
  );
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
