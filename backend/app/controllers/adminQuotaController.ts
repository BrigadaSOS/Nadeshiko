import type { GetAdminUserQuota, ListTiers, UpdateAdminUserQuota } from 'generated/routes/admin';
import type { t_AccountQuotaState, t_Tier } from 'generated/models';
import { AccountQuotaUsage, Tier, User, resolveQuotaLimit } from '@app/models';
import { invalidateTierCache } from '@app/middleware/apiLimiterQuota';
import { invalidateUserCache } from '@app/middleware/authCacheStore';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { logger } from '@config/log';

const toTierDTO = (tier: Tier): t_Tier => ({
  id: tier.id,
  displayName: tier.displayName,
  monthlyQuotaLimit: tier.monthlyQuotaLimit,
  rateLimitMax: tier.rateLimitMax,
  rateLimitWindowMs: tier.rateLimitWindowMs,
  sortOrder: tier.sortOrder,
});

async function quotaState(user: User): Promise<t_AccountQuotaState> {
  const tier = user.tierId ? await Tier.findOne({ where: { id: user.tierId } }) : null;
  const resolved = resolveQuotaLimit({ ...user, tier });
  const usage = await AccountQuotaUsage.getForUser(user.id, resolved.limit);

  return {
    userId: user.id,
    tierId: user.tierId,
    quotaOverride: user.quotaOverride,
    monthlyQuotaLimit: resolved.limit,
    quotaSource: resolved.source,
    quotaUsed: usage.quotaUsed,
    periodYyyymm: usage.periodYyyymm,
  };
}

export const listTiers: ListTiers = async (_params, respond) => {
  const tiers = await Tier.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  return respond.with200().body({ tiers: tiers.map(toTierDTO) });
};

export const getAdminUserQuota: GetAdminUserQuota = async ({ params }, respond) => {
  const user = await User.findOne({ where: { id: params.userId } });
  if (!user) {
    throw new NotFoundError(`User with ID ${params.userId} not found`);
  }
  return respond.with200().body(await quotaState(user));
};

/** Moves an account onto a tier or grants an override; the endpoint records who changed the quota instead of
 * requiring direct production SQL. */
export const updateAdminUserQuota: UpdateAdminUserQuota = async ({ params, body }, respond, req) => {
  const actor = assertUser(req);

  const user = await User.findOne({ where: { id: params.userId } });
  if (!user) {
    throw new NotFoundError(`User with ID ${params.userId} not found`);
  }

  // Read before the write so the audit line can say what actually changed
  // rather than only what it was set to.
  const before = await quotaState(user);

  if (body.tierId !== undefined) {
    // Validate the tier slug here so a typo becomes a client error, not a foreign-key 500.
    const tier = await Tier.findOne({ where: { id: body.tierId } });
    if (!tier) {
      throw new InvalidRequestError(`Unknown tier "${body.tierId}".`);
    }
    user.tierId = tier.id;
  }

  if (body.quotaOverride !== undefined) {
    user.quotaOverride = body.quotaOverride;
  }

  await user.save();

  // Invalidate cached users now so the quota bump applies immediately rather than after auth-cache expiry.
  invalidateUserCache(user.id);
  invalidateTierCache();

  const after = await quotaState(user);

  // Log actor/target ids and before/after quotas so administrative changes remain traceable.
  logger.info(
    {
      event: 'admin.quota.updated',
      'actor.id': actor.id,
      'target.id': user.id,
      'quota.before': { tierId: before.tierId, override: before.quotaOverride, limit: before.monthlyQuotaLimit },
      'quota.after': { tierId: after.tierId, override: after.quotaOverride, limit: after.monthlyQuotaLimit },
      reason: body.reason ?? null,
    },
    'Account quota updated',
  );

  return respond.with200().body(after);
};
