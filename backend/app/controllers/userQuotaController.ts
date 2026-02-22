import type { GetUserQuota } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { AccountQuotaUsage } from '@app/models/AccountQuotaUsage';
import { toUserQuotaDTO } from './mappers/userQuota.mapper';

export const getUserQuota: GetUserQuota = async (_params, respond, req) => {
  const user = assertUser(req);

  const snapshot = await AccountQuotaUsage.getForUser(user.id, user.monthlyQuotaLimit);

  return respond.with200().body(toUserQuotaDTO(snapshot));
};
