import type { Request, Response, NextFunction } from 'express';
import { AuthCredentialsInvalidError, QuotaExceededError } from '@app/errors';
import { ApiKeyKind, AuthType, Tier } from '@app/models';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { resolveQuotaLimit } from '@app/models/quota';
import { captureApiActiveDay } from '@app/services/analytics/posthog';
import { logger } from '@config/log';

/** Cache tiers per process with a TTL: invalidation reaches one worker, so expiry is the cross-worker freshness
 * bound. */
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
  // `undefined` means not loaded; `null` means loaded with no row. A missing tier row is the latter and merits a
  // warning.
  return tierCache.get(tierId) ?? null;
}

/** Guard against registering two finish listeners; otherwise overlapping auth middleware can charge one request
 * twice. */
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

  // Expose quota headers on every authenticated response so the account page avoids a second request for figures it
  // already has.
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
        // Use the same success condition as quota accounting; report the figures read before this request increments
        // them.
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
