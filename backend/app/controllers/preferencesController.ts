import type { GetUserPreferences, UpdateUserPreferences } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User, type UserPreferences } from '@app/models/User';
import { deepMerge } from '@lib/utils/deepMerge';

export const getUserPreferences: GetUserPreferences = async (_params, respond, req) => {
  const user = assertUser(req);

  return respond.with200().body(user.preferences);
};

export const updateUserPreferences: UpdateUserPreferences = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const updated = await mutateUserPreferences(user.id, (current) => {
    return deepMerge(current as Record<string, unknown>, body as Record<string, unknown>) as UserPreferences;
  });
  user.preferences = updated;

  return respond.with200().body(updated);
};

/**
 * Read-modify-write of the preferences JSON under a row lock.
 *
 * The whole column is rewritten on every change, and `req.user` is a copy cached
 * when the request was authenticated, so merging into that copy silently drops
 * anything written since — two browser tabs are enough to lose a change. Holding
 * the row for the read makes the merge see current data and serialises writers.
 *
 * `mutate` runs inside the transaction: throwing from it rolls the write back.
 */
export async function mutateUserPreferences(
  userId: number,
  mutate: (current: UserPreferences) => UserPreferences,
): Promise<UserPreferences> {
  return User.getRepository().manager.transaction(async (manager) => {
    const locked = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.id = :id', { id: userId })
      .getOneOrFail();

    const updated = mutate(locked.preferences ?? {});
    await manager.update(User, { id: userId }, { preferences: updated });

    return updated;
  });
}
