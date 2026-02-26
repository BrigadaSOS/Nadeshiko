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
      query: { disableCookieCache: true },
    });

    const userId = Number(sessionData?.user?.id);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}

export const invalidateAuthCachesAfterMutation: RequestHandler = async (req, res, next) => {
  const pathname = req.path || req.originalUrl.split('?')[0] || '';
  if (!shouldTrackAuthMutation(req.method, pathname)) {
    next();
    return;
  }

  const userId = await resolveAuthenticatedUserId(req.headers);
  if (!userId) {
    next();
    return;
  }

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    invalidateUserCache(userId);
    invalidateApiKeyCacheForUser(userId);
  });

  next();
};
