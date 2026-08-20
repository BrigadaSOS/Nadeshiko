import { ApiKeyKind, ApiPermission, AuthType, User } from '@app/models';
import {
  AuthCredentialsExpiredError,
  AuthCredentialsInvalidError,
  AuthCredentialsRequiredError,
  QuotaExceededError,
  RateLimitExceededError,
} from '@app/errors';
import { Request, Response, NextFunction } from 'express';
import { auth } from '@config/auth';
import { logger } from '@config/log';
import { fromNodeHeaders } from 'better-auth/node';
import { trace } from '@opentelemetry/api';
import {
  getCachedApiKey,
  getCachedUser,
  invalidateUserCache,
  setCachedApiKey,
  setCachedUser,
} from '@app/middleware/authCacheStore';

type VerifyApiKey = (args: { body: { key: string } }) => Promise<unknown>;

/**
 * The session cookie's own name, asked of better-auth rather than rebuilt from
 * `cookiePrefix`.
 *
 * It carries a `__Secure-` prefix wherever `useSecureCookies` is on (production,
 * staging) and none in development, and guessing wrong here fails silently:
 * nothing matches, nothing is forwarded, and sessions keep dying at thirty days
 * with no error to notice. `auth.$context` is a promise resolved once at boot;
 * the result is memoised so this is not a `then` per authenticated request.
 */
let sessionTokenCookieName: Promise<string> | null = null;

function getSessionTokenCookieName(): Promise<string> {
  sessionTokenCookieName ??= auth.$context
    .then((context) => context.authCookies.sessionToken.name)
    .catch((error: unknown) => {
      // Not cached as a rejection: a failure here is almost certainly a boot
      // race, and a permanently poisoned promise would disable cookie renewal
      // for the life of the process.
      sessionTokenCookieName = null;
      throw error;
    });

  return sessionTokenCookieName;
}

/**
 * Hands the browser the session cookie better-auth just renewed.
 *
 * Sessions slide -- `expiresIn` 30 days, `updateAge` 7 (config/auth.ts) -- so a
 * reader who comes back inside a month should never have to sign in again. That
 * needs BOTH halves of the session to move, and until now only one of them did.
 * The `getSession` call below writes the new `expires_at` to the row, but it is
 * an in-process call: better-auth builds the renewed `Set-Cookie`, hands it back
 * on `headers`, and this middleware dropped it. The row slid, the cookie did
 * not, and the browser deleted it exactly 30 days after sign-in however much
 * reading had happened in between.
 *
 * The one path where the header did reach a browser is `/v1/auth/*`, which
 * better-auth answers itself -- in practice the account settings page, via
 * `/list-sessions`. That is the whole reason this looked like it worked for
 * some readers and not others: the ones who never opened settings were logged
 * out on schedule.
 *
 * ONLY the session token, not everything better-auth emits. `get-session` also
 * rewrites the `session_data` cookie cache on every single call, and forwarding
 * that from here would put ~1KB on every API response and have the browser echo
 * it back on every request afterwards -- to fix nothing, since that cookie is a
 * five-minute read cache and its lifetime logs nobody out. The token cookie is
 * written only when a refresh actually happened, so in steady state this
 * appends nothing at all: one small header per reader per week.
 *
 * Appending it to an API response is safe, and that rests on a fact worth
 * stating out loud: every Cloudflare cache rule (brigadasos-infra,
 * terraform/cloudflare-cache.tf) is conditioned on `not http.cookie contains
 * "nadeshiko.session_token"`, so a request that can produce this header is a
 * request the edge never caches. Re-check that before edge-caching anything
 * session-authenticated.
 *
 * Never throws. A failure to renew a cookie must not become a 401 for a reader
 * whose session is perfectly valid -- which is what would happen if this threw
 * inside the caller's `try`.
 */
async function forwardRenewedSessionCookie(res: Response, headers: Headers | undefined | null): Promise<void> {
  try {
    const entries = headers?.getSetCookie?.() ?? [];
    if (entries.length === 0) return;

    const name = await getSessionTokenCookieName();
    // `${name}.` catches the chunked variants better-auth writes when a cookie
    // outgrows the 4KB limit (`${name}.0`, `${name}.1`, ...). The session token
    // is far too short to chunk today, but a filter that would silently forward
    // half a cookie later is not worth the two characters saved.
    const renewed = entries.filter((entry) => entry.startsWith(`${name}=`) || entry.startsWith(`${name}.`));
    if (renewed.length === 0) return;

    for (const cookie of renewed) {
      res.append('Set-Cookie', cookie);
    }
  } catch (error) {
    logger.warn({ err: error }, 'Could not forward the renewed session cookie');
  }
}

export const requireSessionAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.auth) return next();

  try {
    // `returnHeaders` is what makes the renewal above reachable: without it
    // better-auth still slides the row and still builds the cookie, and the
    // cookie is thrown away with the rest of the response envelope.
    const { headers, response: sessionData } = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
      query: { disableCookieCache: true },
      returnHeaders: true,
    });

    await forwardRenewedSessionCookie(res, headers);

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

  await authenticateBetterAuthApiKey(req, apiKey);
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

function extractBearerToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
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
  RATE_LIMITED: () => new RateLimitExceededError('API key rate limit exceeded. Please try again later.', 'key_burst'),
  USAGE_EXCEEDED: () =>
    new QuotaExceededError('API key usage limit exceeded. Please create a new key or wait for refill.', 'key_usage'),
  KEY_DISABLED: () => new AuthCredentialsExpiredError('API key is disabled or expired.'),
  KEY_EXPIRED: () => new AuthCredentialsExpiredError('API key is disabled or expired.'),
  INVALID_API_KEY: () => new AuthCredentialsInvalidError('Invalid API key.'),
  KEY_NOT_FOUND: () => new AuthCredentialsInvalidError('Invalid API key.'),
};

export function inferApiKeyKind(apiKey: { metadata?: unknown }): ApiKeyKind {
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
      return new QuotaExceededError(
        'API key usage limit exceeded. Please create a new key or wait for refill.',
        'key_usage',
      );
    }
    return new RateLimitExceededError('API key rate limit exceeded. Please try again later.', 'key_burst');
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
  const user = await loadActiveUser(userId);

  req.user = user;
  req.auth = {
    type: authType,
    ...(apiKey ? { apiKey } : {}),
  };

  const span = trace.getActiveSpan();
  if (span) span.setAttribute('enduser.id', String(userId));
}

async function loadActiveUser(userId: number): Promise<User> {
  let user = getCachedUser(userId);
  if (!user) {
    user = await User.findOne({ where: { id: userId } });
    if (!user?.isActive) {
      throw new AuthCredentialsInvalidError('User is invalid or inactive.');
    }
    setCachedUser(user);
  } else if (!user.isActive) {
    invalidateUserCache(userId);
    throw new AuthCredentialsInvalidError('User is invalid or inactive.');
  }

  return user;
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
      referenceId?: string | number;
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

  const userId = Number(verification.key.referenceId);
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
export function assertUser(req: Request): User {
  if (!req.user) {
    throw new Error('assertUser: req.user is not set — auth middleware may not have run');
  }
  return req.user;
}
