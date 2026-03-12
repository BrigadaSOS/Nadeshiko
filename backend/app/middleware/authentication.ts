import { ApiAuth, ApiKeyKind, ApiPermission, AuthType, User } from '@app/models';
import {
  AuthCredentialsExpiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsRequiredError,
  QuotaExceededError,
  RateLimitExceededError,
} from '@app/errors';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { auth } from '@config/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { defaultKeyHasher } from 'better-auth/plugins';
import { AppDataSource } from '@config/database';
import { logger } from '@config/log';
import {
  getCachedApiKey,
  getCachedUser,
  invalidateUserCache,
  setCachedApiKey,
  setCachedUser,
} from '@app/middleware/authCacheStore';

const BETTER_AUTH_PREFIX = 'nade_';
const BETTER_AUTH_PERMISSION_RESOURCE = 'api';
type VerifyApiKey = (args: { body: { key: string } }) => Promise<unknown>;

export const requireSessionAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (req.auth) return next();

  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
    });

    if (!sessionData?.user?.id) {
      throw new AuthCredentialsRequiredError('Session token missing.');
    }

    const userId = Number(sessionData.user.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AuthCredentialsInvalidError('Invalid session user id.');
    }

    await attachAuthPayloadToRequest(req, userId, AuthType.SESSION);
    next();
  } catch (error) {
    if (isKnownAuthError(error)) {
      throw error;
    }
    throw new AuthCredentialsInvalidError('Invalid or expired session.');
  }
};

export const requireApiKeyAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (req.auth) return next();

  const apiKey = extractBearerToken(req);

  if (!apiKey) {
    throw new AuthCredentialsRequiredError('No API key was provided in Authorization header.');
  }

  if (apiKey.startsWith(BETTER_AUTH_PREFIX)) {
    // Keys with the Better Auth prefix go directly to Better Auth
    await authenticateBetterAuthApiKey(req, apiKey);
  } else {
    // All other keys use legacy auth (with auto-migration to Better Auth)
    await authenticateLegacyApiKey(req, apiKey);
  }

  next();
};

function isKnownAuthError(
  error: unknown,
): error is AuthCredentialsRequiredError | AuthCredentialsInvalidError | AuthCredentialsExpiredError {
  return (
    error instanceof AuthCredentialsRequiredError ||
    error instanceof AuthCredentialsInvalidError ||
    error instanceof AuthCredentialsExpiredError
  );
}

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function extractBearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

const VALID_PERMISSIONS = new Set<string>(Object.values(ApiPermission));

function flattenBetterAuthPermissions(rawPermissions: unknown): ApiPermission[] {
  if (!rawPermissions || typeof rawPermissions !== 'object') {
    return [];
  }

  const permissions = Object.values(rawPermissions as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is ApiPermission => typeof value === 'string' && VALID_PERMISSIONS.has(value));

  return Array.from(new Set(permissions));
}

function parseApiKeyMetadata(rawMetadata: unknown): Record<string, unknown> | null {
  if (!rawMetadata) {
    return null;
  }

  if (typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)) {
    return rawMetadata as Record<string, unknown>;
  }

  if (typeof rawMetadata !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(rawMetadata);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type MappedApiKeyError =
  | AuthCredentialsInvalidError
  | AuthCredentialsExpiredError
  | RateLimitExceededError
  | QuotaExceededError;
const BETTER_AUTH_API_KEY_ERROR_FACTORIES: Record<string, () => MappedApiKeyError> = {
  RATE_LIMITED: () => new RateLimitExceededError('API key rate limit exceeded. Please try again later.'),
  USAGE_EXCEEDED: () =>
    new QuotaExceededError('API key usage limit exceeded. Please create a new key or wait for refill.'),
  KEY_DISABLED: () => new AuthCredentialsExpiredError('API key is disabled or expired.'),
  KEY_EXPIRED: () => new AuthCredentialsExpiredError('API key is disabled or expired.'),
  INVALID_API_KEY: () => new AuthCredentialsInvalidError('Invalid API key.'),
  KEY_NOT_FOUND: () => new AuthCredentialsInvalidError('Invalid API key.'),
};

function inferApiKeyKind(apiKey: { metadata?: unknown }): ApiKeyKind {
  const metadata = parseApiKeyMetadata(apiKey.metadata);
  if (!metadata) {
    return ApiKeyKind.USER;
  }

  const keyType = typeof metadata.keyType === 'string' ? metadata.keyType.toLowerCase() : null;
  const isService = metadata.isService === true;

  if (keyType === 'service' || isService) {
    return ApiKeyKind.SERVICE;
  }

  return ApiKeyKind.USER;
}

function mapBetterAuthApiKeyError(error: unknown): MappedApiKeyError | null {
  if (typeof error === 'string') {
    const mappedByCode = BETTER_AUTH_API_KEY_ERROR_FACTORIES[error];
    return mappedByCode ? mappedByCode() : null;
  }

  if (!error || typeof error !== 'object') {
    return null;
  }
  const maybeError = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    body?: {
      code?: unknown;
      message?: unknown;
    };
  };

  const code = typeof maybeError.body?.code === 'string' ? maybeError.body.code : maybeError.code;
  if (typeof code === 'string') {
    const mappedByCode = BETTER_AUTH_API_KEY_ERROR_FACTORIES[code];
    if (mappedByCode) {
      return mappedByCode();
    }
  }

  const status = typeof maybeError.status === 'string' ? maybeError.status : '';
  const statusCode = typeof maybeError.statusCode === 'number' ? maybeError.statusCode : -1;
  const message = typeof maybeError.message === 'string' ? maybeError.message : '';
  const bodyMessage = typeof maybeError.body?.message === 'string' ? maybeError.body.message : '';
  const combinedMessage = `${message} ${bodyMessage}`.trim();

  if (statusCode === 429 || status === 'TOO_MANY_REQUESTS') {
    if (/usage exceeded/i.test(combinedMessage)) {
      return new QuotaExceededError('API key usage limit exceeded. Please create a new key or wait for refill.');
    }
    return new RateLimitExceededError('API key rate limit exceeded. Please try again later.');
  }

  if ((statusCode === 401 || status === 'UNAUTHORIZED') && /invalid api key/i.test(combinedMessage)) {
    return new AuthCredentialsInvalidError('Invalid API key.');
  }

  return null;
}

async function attachAuthPayloadToRequest(
  req: Request,
  userId: number,
  authType: AuthType,
  apiKey?: { id?: string; kind?: ApiKeyKind; permissions: ApiPermission[] },
): Promise<void> {
  let user = getCachedUser(userId);
  if (!user) {
    user = await User.findOne({ where: { id: userId }, relations: ['labEnrollments'] });
    if (!user || !user.isActive) {
      throw new AuthCredentialsInvalidError('User is invalid or inactive.');
    }
    setCachedUser(user);
  } else if (!user.isActive) {
    invalidateUserCache(userId);
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  req.user = user;
  req.auth = {
    type: authType,
    ...(apiKey ? { apiKey } : {}),
  };
}

async function authenticateBetterAuthApiKey(req: Request, apiKey: string): Promise<void> {
  // Check cache first to avoid better-auth DB call
  const cached = getCachedApiKey(apiKey);
  if (cached) {
    await attachAuthPayloadToRequest(req, cached.userId, AuthType.API_KEY, {
      id: cached.apiKeyId,
      kind: cached.apiKeyKind,
      permissions: cached.permissions,
    });
    return;
  }

  let verification: {
    valid?: boolean;
    key?: {
      id?: string | number;
      userId?: string | number;
      permissions?: unknown;
      metadata?: unknown;
    } | null;
    error?: {
      code?: string;
    } | null;
  };

  try {
    const verifyApiKey = (auth.api as { verifyApiKey?: VerifyApiKey }).verifyApiKey;
    if (typeof verifyApiKey !== 'function') {
      throw new AuthCredentialsInvalidError('API key verification is not configured.');
    }
    verification = (await verifyApiKey({
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
    const mappedError = mapBetterAuthApiKeyError(verification?.error?.code);
    if (mappedError) {
      throw mappedError;
    }
    throw new AuthCredentialsInvalidError('Invalid API key.');
  }

  const userId = Number(verification.key.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AuthCredentialsInvalidError('Invalid API key owner.');
  }

  const apiKeyId =
    verification.key.id !== undefined && verification.key.id !== null ? String(verification.key.id) : undefined;
  const apiKeyKind = inferApiKeyKind(verification.key);
  const permissions = flattenBetterAuthPermissions(verification.key.permissions);

  // Cache the verified key for subsequent requests
  setCachedApiKey(apiKey, { userId, apiKeyId, apiKeyKind, permissions });

  await attachAuthPayloadToRequest(req, userId, AuthType.API_KEY, {
    id: apiKeyId,
    kind: apiKeyKind,
    permissions,
  });
}

async function authenticateLegacyApiKey(req: Request, apiKey: string): Promise<void> {
  const hashedKey = hashApiKey(apiKey);

  const apiAuth = await ApiAuth.findOne({
    where: { token: hashedKey },
  });

  if (!apiAuth) {
    throw new AuthCredentialsInvalidError('Invalid API key.');
  }

  if (!apiAuth.isActive) {
    // Key was migrated to Better Auth — verify through that flow
    await authenticateBetterAuthApiKey(req, apiKey);
    return;
  }

  if (apiAuth.userId == null) {
    throw new AuthCredentialsInvalidError('API key has no associated user.');
  }

  await attachAuthPayloadToRequest(req, apiAuth.userId, AuthType.API_KEY_LEGACY, {
    kind: ApiKeyKind.USER,
    permissions: [ApiPermission.READ_MEDIA],
  });

  // Auto-migrate legacy keys to Better Auth
  migrateLegacyKeyToBetterAuth(apiKey, apiAuth).catch((error) => {
    logger.warn({ error, apiAuthId: apiAuth.id }, 'Legacy API key migration failed (non-fatal)');
  });
}

async function migrateLegacyKeyToBetterAuth(plaintextKey: string, legacyRecord: ApiAuth): Promise<void> {
  const hashedKey = await defaultKeyHasher(plaintextKey);

  const separatorIndex = plaintextKey.indexOf('_');
  const keyPrefix = separatorIndex > 0 ? plaintextKey.slice(0, separatorIndex + 1) : null;

  const permissions = JSON.stringify({ [BETTER_AUTH_PERMISSION_RESOURCE]: [ApiPermission.READ_MEDIA] });
  const metadata = JSON.stringify({ source: 'legacy-migration' });

  await AppDataSource.query(
    `
      INSERT INTO "apikey" (
        "name",
        "start",
        "prefix",
        "key",
        "userId",
        "enabled",
        "rateLimitEnabled",
        "metadata",
        "permissions",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, true, false, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO NOTHING
    `,
    [
      legacyRecord.name,
      plaintextKey.slice(0, 6),
      keyPrefix,
      hashedKey,
      legacyRecord.userId,
      metadata,
      permissions,
    ],
  );

  // Deactivate the legacy record
  legacyRecord.isActive = false;
  await legacyRecord.save();

  logger.info({ apiAuthId: legacyRecord.id, userId: legacyRecord.userId }, 'Legacy API key migrated to Better Auth');
}

export function assertUser(req: Request): User {
  if (!req.user) {
    throw new Error('assertUser: req.user is not set — auth middleware may not have run');
  }
  return req.user;
}
