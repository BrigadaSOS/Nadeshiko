import type { Request, Response, NextFunction } from 'express';
import { AuthCredentialsInvalidError, QuotaExceededError } from '@app/errors';
import { ApiKeyKind, AuthType, Tier } from '@app/models';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { resolveQuotaLimit } from '@app/models/quota';
import { captureApiActiveDay } from '@app/services/analytics/posthog';
import { logger } from '@config/log';

/**
 * The tier table, cached per process.
 *
 * There are three rows and they change only when somebody edits a tier, which
 * is not on any request path -- so joining the table on every authenticated
 * call would buy nothing but a round trip per request.
 *
 * THE TTL IS NOT OPTIONAL, tempting as it looks for a table this static.
 * Production forks three workers; `invalidateTierCache` only ever clears the
 * one that served the admin request, so without an expiry the other two would
 * keep billing against the old tier until the next deploy. Five minutes matches
 * what the auth caches next door already accept for the same reason, and it is
 * the ceiling on how long a quota bump can look like it did not work.
 */
const TIER_CACHE_TTL_MS = 5 * 60 * 1000;

let tierCache: Map<string, Tier> | null = null;
let tierCacheExpiresAt = 0;

export function invalidateTierCache(): void {
  tierCache = null;
}

async function loadTier(tierId: string | null): Promise<Tier | null | undefined> {
  if (tierId === null) return null;
  if (!tierCache || Date.now() >= tierCacheExpiresAt) {
    const rows = await Tier.find();
    tierCache = new Map(rows.map((row) => [row.id, row]));
    tierCacheExpiresAt = Date.now() + TIER_CACHE_TTL_MS;
  }
  // `undefined` and `null` mean different things to the resolver: undefined is
  // "not loaded", null is "loaded and there is none". A tier id with no row is
  // the second -- the row is gone, and that is worth warning about.
  return tierCache.get(tierId) ?? null;
}

/**
 * Requests that already carry a quota increment listener.
 *
 * A request that matched two `routeAuth` entries would run this middleware
 * twice and register two `finish` listeners, billing the caller twice for one
 * call. No route overlaps today, so this only ever guards against a future one
 * — the same re-entry guard `requireSessionAuth` keeps on `req.auth`.
 */
const quotaCountedRequests = new WeakSet<Request>();

export const rateLimitApiQuota = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (req.auth?.type !== AuthType.API_KEY) {
    next();
    return;
  }

  if (req.auth.apiKey?.kind === ApiKeyKind.SERVICE) {
    next();
    return;
  }

  const user = req.user;
  if (!user) {
    throw new AuthCredentialsInvalidError('Invalid API key owner.');
  }

  const resolved = resolveQuotaLimit({ ...user, tier: await loadTier(user.tierId ?? null) });
  const quota = await AccountQuotaUsage.getForUser(user.id, resolved.limit);
  req.accountQuota = quota;

  // Announced on every authenticated response, not only on the rejection: the
  // account page renders "4,927 / 5,000" from these, and a page that had to ask
  // a separate endpoint for them would pay a round trip to say what the call it
  // just made already knew. Cheap -- two integers on a response that is going
  // out anyway.
  res.setHeader('X-Monthly-Quota-Limit', String(quota.quotaLimit));
  res.setHeader('X-Monthly-Quota-Used', String(quota.quotaUsed));
  res.setHeader('X-Monthly-Quota-Reset', AccountQuotaUsage.getQuotaWindow(quota.periodYyyymm).periodEnd);

  if (quota.quotaUsed >= quota.quotaLimit) {
    throw new QuotaExceededError(
      `Monthly quota exceeded: used ${quota.quotaUsed} of ${quota.quotaLimit} requests for this account.`,
    );
  }

  if (!quotaCountedRequests.has(req)) {
    quotaCountedRequests.add(req);

    res.on('finish', () => {
      logger.debug({ userId: user.id, statusCode: res.statusCode }, 'API quota finish callback fired');
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Same success condition as the quota increment, so "an active day" and
        // "a request that counted against the quota" can never disagree. The
        // quota figures are the ones read above, i.e. before this request was
        // added -- month-to-date as the day's first call found it.
        captureApiActiveDay({ userId: user.id, quotaUsed: quota.quotaUsed, quotaLimit: quota.quotaLimit });

        AccountQuotaUsage.incrementForUser(user.id)
          .then(() => {
            logger.debug({ userId: user.id }, 'Account quota incremented successfully');
          })
          .catch((err: unknown) => {
            logger.warn({ err, userId: user.id }, 'Failed to increment account quota usage');
          });
      }
    });
  }

  next();
};
