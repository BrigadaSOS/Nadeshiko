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

/** Normalize fat, slim, and id-only preference entries on write so mixed deployments and old rows remain readable. */
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

/** Reject hiding every category: an empty category filter means “no filter” and would expose the whole corpus. */
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

/** Cap favorites because the whole preferences JSON is rewritten on every change; otherwise any later preference
 * write pays for an unbounded list. */
export const MAX_FAVORITE_MEDIA = 100;

/** Enforce the cap at both endpoints: `PATCH /preferences` deep-merges input and otherwise bypasses the dedicated
 * endpoint’s check. */
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

/** Read and merge current preferences under a row lock; never merge the cached `req.user` copy, or concurrent tabs
 * can lose updates. */
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
