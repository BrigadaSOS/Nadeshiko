import { ApiAuth, User } from '@app/entities';
import {
  AuthCredentialsExpiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsRequiredError,
  QuotaExceededError,
  RateLimitExceededError,
} from '@lib/utils/apiErrors';
import { Request, Response, NextFunction } from 'express';
import { hashApiKey } from '@lib/utils/utils';
import { auth } from '@lib/auth';
import { fromNodeHeaders } from 'better-auth/node';

type RequestAuthType = 'session' | 'api-key-better-auth' | 'api-key-legacy';
type ApiKeyKind = 'service' | 'user';

const LEGACY_API_KEY_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_MASTER_API_KEY = process.env.API_KEY_MASTER?.trim();
const SERVICE_API_KEY_IDS = new Set(
  (process.env.SERVICE_API_KEY_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

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

    await attachAuthPayloadToRequest(req, userId, 'session');
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
  req.apiKey = apiKey;

  if (!apiKey) {
    throw new AuthCredentialsRequiredError('No API key was provided in Authorization header.');
  }

  const isLegacy = looksLikeLegacyApiKey(apiKey);

  // Legacy format keys (UUIDs) go directly to legacy authentication
  if (isLegacy) {
    await authenticateLegacyApiKey(req, apiKey);
    next();
    return;
  }

  // All other keys (including master API key) try Better Auth first
  try {
    await authenticateBetterAuthApiKey(req, apiKey);
    next();
    return;
  } catch (error) {
    if (!isKnownAuthError(error)) {
      throw error;
    }
  }

  // Fallback to legacy authentication for non-UUID keys
  try {
    await authenticateLegacyApiKey(req, apiKey);
    next();
    return;
  } catch (error) {
    if (!isKnownAuthError(error)) {
      throw error;
    }
  }

  throw new AuthCredentialsInvalidError('Invalid API key.');
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

function extractBearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
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

function inferApiKeyKind(apiKey: { id?: string | number; metadata?: unknown }): ApiKeyKind {
  if (apiKey.id !== undefined && apiKey.id !== null && SERVICE_API_KEY_IDS.has(String(apiKey.id))) {
    return 'service';
  }

  const metadata = parseApiKeyMetadata(apiKey.metadata);
  if (!metadata) {
    return 'user';
  }

  const keyType = typeof metadata.keyType === 'string' ? metadata.keyType.toLowerCase() : null;
  const isService = metadata.isService === true;

  if (keyType === 'service' || isService) {
    return 'service';
  }

  return 'user';
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
  authType: RequestAuthType,
  options: { apiKeyId?: string; apiKeyKind?: ApiKeyKind } = {},
): Promise<void> {
  const user = await User.findOne({ where: { id: userId } });
  if (!user || !user.isActive) {
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  req.jwt = {
    user_id: userId,
    role: user.role,
  };
  req.auth = {
    type: authType,
    user_id: userId,
    ...(options.apiKeyId ? { apiKeyId: options.apiKeyId } : {}),
    ...(options.apiKeyKind ? { apiKeyKind: options.apiKeyKind } : {}),
  };
}

async function authenticateBetterAuthApiKey(req: Request, apiKey: string): Promise<void> {
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

  await attachAuthPayloadToRequest(req, userId, 'api-key-better-auth', {
    apiKeyId,
    apiKeyKind,
  });
  req.user = undefined;
  req.apiKeyPermissions = permissions;
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

  await attachAuthPayloadToRequest(req, user.id, 'api-key-legacy', {
    apiKeyKind: isLegacyMasterApiKey(apiKey) ? 'service' : 'user',
  });
  req.user = user;
  req.apiKeyPermissions = (user.apiAuth?.permissions ?? []).map(
    (permission: { apiPermission: string }) => permission.apiPermission,
  );
}
