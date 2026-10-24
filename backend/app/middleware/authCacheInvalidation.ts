import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '@config/auth';
import { invalidateApiKeyCacheForUser, invalidateUserCache } from '@app/middleware/authCacheStore';

const AUTH_MUTATION_ROUTES = new Set<string>([
  '/v1/auth/api-key/create',
  '/v1/auth/api-key/update',
  '/v1/auth/api-key/delete',
  '/v1/auth/sign-out',
  '/v1/auth/revoke-session',
  '/v1/auth/revoke-sessions',
  '/v1/auth/revoke-other-sessions',
  '/v1/auth/delete-user',
]);

/** Admin mutations act on `body.userId`, not the caller: a demoted or banned user must not keep the cached role or
 * ban state on their live session for the cache TTL. */
const ADMIN_TARGET_MUTATION_ROUTES = new Set<string>([
  '/v1/auth/admin/set-role',
  '/v1/auth/admin/ban-user',
  '/v1/auth/admin/unban-user',
  '/v1/auth/admin/update-user',
  '/v1/auth/admin/remove-user',
]);

function normalizePath(pathname: string): string {
  return pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
}

function shouldTrackAuthMutation(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== 'POST') {
    return false;
  }

  return AUTH_MUTATION_ROUTES.has(normalizePath(pathname));
}

async function resolveAuthenticatedUserId(headers: NodeJS.Dict<string | string[]>): Promise<number | null> {
  try {
    const sessionData = await auth.api.getSession({
      headers: fromNodeHeaders(headers),
      // Use `disableRefresh`: this lookup needs identity only and must not consume a renewal it cannot return.
      query: { disableCookieCache: true, disableRefresh: true },
    });

    const userId = Number(sessionData?.user?.id);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

function resolveAdminTargetUserId(method: string, pathname: string, body: unknown): number | null {
  if (method.toUpperCase() !== 'POST' || !ADMIN_TARGET_MUTATION_ROUTES.has(normalizePath(pathname))) {
    return null;
  }

  const userId = Number((body as { userId?: unknown } | undefined)?.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function invalidateOnSuccess(res: Parameters<RequestHandler>[1], userId: number): void {
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    invalidateUserCache(userId);
    invalidateApiKeyCacheForUser(userId);
  });
}

export const invalidateAuthCachesAfterMutation: RequestHandler = async (req, res, next) => {
  const pathname = req.path || req.originalUrl.split('?')[0] || '';

  // The admin plugin authorizes the caller; a 2xx is the proof the target changed.
  const targetUserId = resolveAdminTargetUserId(req.method, pathname, req.body);
  if (targetUserId) {
    invalidateOnSuccess(res, targetUserId);
    next();
    return;
  }

  if (!shouldTrackAuthMutation(req.method, pathname)) {
    next();
    return;
  }

  const userId = await resolveAuthenticatedUserId(req.headers);
  if (!userId) {
    next();
    return;
  }

  invalidateOnSuccess(res, userId);
  next();
};
