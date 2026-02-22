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

const BETTER_AUTH_PREFIX = 'nade_';
const BETTER_AUTH_PERMISSION_RESOURCE = 'api';

// In-memory cache for User lookups (avoids DB hit on every authenticated request)
const USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const userCache = new Map<number, { user: User; expiresAt: number }>();

function getCachedUser(userId: number): User | null {
  const entry = userCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(user: User): void {
  userCache.set(user.id, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

export function invalidateUserCache(userId: number): void {
  userCache.delete(userId);
}

// In-memory cache for API key verification (avoids better-auth DB hit on every request)
const API_KEY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface ApiKeyCacheEntry {
  userId: number;
  apiKeyId: string | undefined;
  apiKeyKind: ApiKeyKind;
  permissions: ApiPermission[];
  expiresAt: number;
}
const apiKeyCache = new Map<string, ApiKeyCacheEntry>();

function getCachedApiKey(key: string): ApiKeyCacheEntry | null {
  const entry = apiKeyCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) apiKeyCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedApiKey(key: string, entry: Omit<ApiKeyCacheEntry, 'expiresAt'>): void {
  apiKeyCache.set(key, { ...entry, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS });
}

export function invalidateApiKeyCacheForUser(userId: number): void {
  for (const [key, entry] of apiKeyCache) {
    if (entry.userId === userId) {
      apiKeyCache.delete(key);
    }
  }
}

export const requireSessionAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
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

function mapBetterAuthApiKeyCode(
  code: unknown,
): AuthCredentialsInvalidError | AuthCredentialsExpiredError | RateLimitExceededError | QuotaExceededError | null {
  if (typeof code !== 'string') {
    return null;
  }

  if (code === 'RATE_LIMITED') {
    return new RateLimitExceededError('API key rate limit exceeded. Please try again later.');
  }

  if (code === 'USAGE_EXCEEDED') {
    return new QuotaExceededError('API key usage limit exceeded. Please create a new key or wait for refill.');
  }

  if (code === 'KEY_DISABLED' || code === 'KEY_EXPIRED') {
    return new AuthCredentialsExpiredError('API key is disabled or expired.');
  }

  if (code === 'INVALID_API_KEY') {
    return new AuthCredentialsInvalidError('Invalid API key.');
  }

  if (code === 'KEY_NOT_FOUND') {
    return new AuthCredentialsInvalidError('Invalid API key.');
  }

  return null;
}

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

function mapBetterAuthApiKeyError(
  error: unknown,
): AuthCredentialsInvalidError | AuthCredentialsExpiredError | RateLimitExceededError | QuotaExceededError | null {
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

  const mappedFromCode = mapBetterAuthApiKeyCode(maybeError.body?.code);
  if (mappedFromCode) {
    return mappedFromCode;
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
    user = await User.findOne({ where: { id: userId }, relations: ['experimentEnrollments'] });
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
    const mappedError = mapBetterAuthApiKeyCode(verification?.error?.code);
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
    throw new AuthCredentialsExpiredError('API key has been deactivated.');
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
      `Migrated Legacy Key #${legacyRecord.id}`,
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
