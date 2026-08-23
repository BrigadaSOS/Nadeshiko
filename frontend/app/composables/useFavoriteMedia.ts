import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import { handleApiError } from '~/utils/apiError';

export type FavoriteMediaItem = NonNullable<UserPreferences['favoriteMedia']>[number];

/**
 * Matches `MAX_FAVORITE_MEDIA` in the backend's `preferencesController`. Checked
 * here only to disable the control and explain why; the server is what enforces
 * it, since a client-side ceiling is a suggestion.
 */
export const MAX_FAVORITE_MEDIA = 100;

/**
 * The titles a reader has starred, which sort to the top of the search media
 * filter.
 *
 * Reads straight from the user store's preferences, so it is correct during SSR
 * -- preferences are hydrated before the first render, which is why the filter
 * can be ordered server-side and never reshuffles under the cursor after
 * hydration. A signed-out reader has no favorites and gets today's plain
 * alphabetical list.
 *
 * An entry is `{ mediaPublicId, favoritedAt }`; entries stored before the lists
 * were slimmed also carry the title's names, which nothing reads. The predicate
 * below accepts both because it only ever asks for `mediaPublicId`.
 */
export function useFavoriteMedia() {
  const user = userStore();

  const items = computed<FavoriteMediaItem[]>(() => {
    if (!user.isLoggedIn) return [];
    const raw = user.preferences?.favoriteMedia;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is FavoriteMediaItem => !!item && typeof item === 'object' && typeof item.mediaPublicId === 'string',
    );
  });

  /** A Set because the sort comparator asks this per row, per keystroke. */
  const favoriteMediaIds = computed<Set<string>>(() => new Set(items.value.map((item) => item.mediaPublicId)));

  const isFavorite = (mediaPublicId: string): boolean => favoriteMediaIds.value.has(mediaPublicId);

  const atCap = computed<boolean>(() => items.value.length >= MAX_FAVORITE_MEDIA);

  /**
   * Returns whether the change reached the server; see `useHiddenMedia`. Takes
   * the whole media row because the search filter's star has one in hand -- the
   * names on it are no longer stored, only the id and the server's timestamp.
   */
  const toggleFavorite = async (media: {
    publicId: string;
    nameEn?: string;
    nameJa?: string;
    nameRomaji?: string;
  }): Promise<boolean> => {
    if (!user.isLoggedIn) return false;

    const existing = items.value.findIndex((item) => item.mediaPublicId === media.publicId);
    const isUnfavoriting = existing >= 0;

    if (!isUnfavoriting && atCap.value) {
      handleApiError('favorite-media:cap-reached', new Error('Favorite media cap reached'), {
        toastKey: 'favoriteMedia.capReached',
        context: { 'media.publicId': media.publicId },
      });
      return false;
    }

    const nextItems: FavoriteMediaItem[] = isUnfavoriting
      ? items.value.filter((_, i) => i !== existing)
      : [
          ...items.value,
          {
            mediaPublicId: media.publicId,
            // Optimistic placeholder only. The server sets the stored value, and
            // the next load replaces this with it.
            favoritedAt: new Date().toISOString(),
          },
        ];

    const previousItems = items.value;
    user.preferences = {
      ...(user.preferences ?? {}),
      favoriteMedia: nextItems,
    };

    let saved = true;
    try {
      const sdk = useNadeshikoSdk();
      if (isUnfavoriting) {
        await sdk.removeFavoriteMedia({ mediaPublicId: media.publicId });
      } else {
        await sdk.addFavoriteMedia({ mediaPublicId: media.publicId });
      }
    } catch (error) {
      // Roll back rather than leave the row sorted to the top of a list that
      // every other device, and the next page load, will order differently.
      user.preferences = {
        ...(user.preferences ?? {}),
        favoriteMedia: previousItems,
      };
      handleApiError('favorite-media:toggle-failed', error, {
        toastKey: 'favoriteMedia.updateError',
        context: { 'media.publicId': media.publicId, action: isUnfavoriting ? 'unfavorite' : 'favorite' },
      });
      saved = false;
    }

    // Deliberately no `force-search-counter` bump, unlike `useHiddenMedia`:
    // starring changes the order of the filter, not which results exist, so
    // refiring the search would be a round trip for an identical answer.

    return saved;
  };

  return {
    items,
    favoriteMediaIds,
    isFavorite,
    atCap,
    toggleFavorite,
  };
}
