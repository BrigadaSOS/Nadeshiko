import type { GetUserPreferences, UpdateUserPreferences } from 'generated/routes/user';
import { assertUser } from '@app/middleware/authentication';
import { User, type FavoriteMediaItem, type HiddenMediaItem, type UserPreferences } from '@app/models/User';
import { ALL_CATEGORIES } from '@app/models/Media';
import { ValidationFailedError } from '@app/errors';
import { deepMerge } from '@lib/utils/deepMerge';

/**
 * The date a favourite gets when the stored entry has none. Sorts last in the
 * newest-first settings list, which is the honest place for "we do not know".
 */
const UNKNOWN_FAVORITED_AT = new Date(0).toISOString();

/** The id out of either shape: a bare string now, `{ mediaPublicId }` before. */
function toMediaPublicId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry || null;
  const id = (entry as { mediaPublicId?: unknown } | null)?.mediaPublicId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Both media lists coerced to the slim shape, whatever the row holds.
 *
 * Three shapes reach this function and all three are real, which is why it reads
 * rather than assumes:
 *
 *   - the fat objects every production row held before
 *     `SlimMediaPreferences1787200000000`, and that an old container still
 *     writes for as long as kamal runs one beside the new ones
 *   - the slim objects written from now on
 *   - bare id strings, which nothing writes today but which `hiddenMedia` is
 *     meant to become once no old reader is left; accepting them now is what
 *     lets that later change be a one-liner instead of another migration
 *
 * Without it a reader served by a container that had already dropped the names
 * would watch every title they hid come back, and `GET /v1/user/preferences`
 * would fail its own response validation on the way out.
 *
 * Applied on the way *in* to every write (see `mutateUserPreferences`), so a
 * stale row heals the first time anything about the account changes, not only
 * when someone touches these two lists.
 */
export function normalizeMediaPreferences(preferences: UserPreferences): UserPreferences {
  const normalized: UserPreferences = { ...preferences };

  if (Array.isArray(preferences.hiddenMedia)) {
    normalized.hiddenMedia = (preferences.hiddenMedia as unknown[])
      .map(toMediaPublicId)
      .filter((id): id is string => id !== null)
      .map((mediaPublicId): HiddenMediaItem => ({ mediaPublicId }));
  }

  if (Array.isArray(preferences.favoriteMedia)) {
    normalized.favoriteMedia = (preferences.favoriteMedia as unknown[])
      .map((entry): FavoriteMediaItem | null => {
        const mediaPublicId = toMediaPublicId(entry);
        if (!mediaPublicId) return null;
        const favoritedAt = (entry as { favoritedAt?: unknown } | null)?.favoritedAt;
        return { mediaPublicId, favoritedAt: typeof favoritedAt === 'string' ? favoritedAt : UNKNOWN_FAVORITED_AT };
      })
      .filter((item): item is FavoriteMediaItem => item !== null);
  }

  return normalized;
}

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

/**
 * How many titles a reader may star.
 *
 * The whole preferences column is rewritten on every change (see
 * `mutateUserPreferences`), so an unbounded list would tax every later write of
 * any unrelated preference, forever. 100 is far past what the feature is for --
 * sorting the handful of shows you know to the top of a filter.
 */
export const MAX_FAVORITE_MEDIA = 100;

/**
 * Checked here as well as in `addFavoriteMedia` because there are two doors into
 * this list: the dedicated endpoint, and `PATCH /v1/user/preferences`, which
 * deep-merges whatever it is handed. Guarding only the former leaves the cap
 * trivially bypassable by the client that skips it.
 */
export function assertFavoriteMediaWithinCap(preferences: UserPreferences): void {
  const favorites = preferences.favoriteMedia;
  if (!favorites) return;

  if (favorites.length > MAX_FAVORITE_MEDIA) {
    throw new ValidationFailedError({
      favoriteMedia: `At most ${MAX_FAVORITE_MEDIA} media can be starred.`,
    });
  }
}

export const getUserPreferences: GetUserPreferences = async (_params, respond, req) => {
  const user = assertUser(req);

  // `req.user` is the row as it is stored, which for an account nobody has
  // written to since the slimming is still the old shape.
  return respond.with200().body(normalizeMediaPreferences(user.preferences ?? {}));
};

export const updateUserPreferences: UpdateUserPreferences = async ({ body }, respond, req) => {
  const user = assertUser(req);

  const updated = await mutateUserPreferences(user.id, (current) => {
    const merged = deepMerge(current as Record<string, unknown>, body as Record<string, unknown>) as UserPreferences;
    assertNotEveryCategoryHidden(merged);
    assertFavoriteMediaWithinCap(merged);
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

    const updated = mutate(normalizeMediaPreferences(locked.preferences ?? {}));
    await manager.update(User, { id: userId }, { preferences: updated });

    return updated;
  });
}
