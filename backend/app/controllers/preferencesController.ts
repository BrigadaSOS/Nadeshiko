import type { GetUserPreferences, UpdateUserPreferences } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User, type UserPreferences } from '@app/models/User';
import { ALL_CATEGORIES } from '@app/models/Media';
import { ValidationFailedError } from '@app/errors';
import { deepMerge } from '@lib/utils/deepMerge';

/**
 * Hiding every category is refused rather than stored.
 *
 * `filters.category` reads an empty term list as "no filter" (see
 * `filterRegistry.ts`), so a client that hid the last visible category would send
 * an empty list and get the *whole* corpus back -- the exact opposite of what the
 * reader asked for. Checked against `ALL_CATEGORIES` rather than a hardcoded
 * ceiling so adding a category widens the rule on its own.
 */
function assertNotEveryCategoryHidden(preferences: UserPreferences): void {
  const hidden = preferences.hiddenCategories;
  if (!hidden) return;

  const distinct = new Set(hidden.filter((category) => ALL_CATEGORIES.includes(category)));
  if (distinct.size >= ALL_CATEGORIES.length) {
    throw new ValidationFailedError({
      hiddenCategories: 'At least one category must stay visible.',
    });
  }
}

export const getUserPreferences: GetUserPreferences = async (_params, respond, req) => {
  const user = assertUser(req);

  return respond.with200().body(user.preferences);
};

export const updateUserPreferences: UpdateUserPreferences = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const updated = await mutateUserPreferences(user.id, (current) => {
    const merged = deepMerge(current as Record<string, unknown>, body as Record<string, unknown>) as UserPreferences;
    assertNotEveryCategoryHidden(merged);
    return merged;
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
