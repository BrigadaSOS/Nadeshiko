import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import type { MediaFilterItem } from '~/types/search';
import { handleApiError } from '~/utils/apiError';

type HiddenMediaItem = NonNullable<UserPreferences['hiddenMedia']>[number];

const LEGACY_LOCAL_STORAGE_KEY = 'nadeshiko.hiddenMedia';

// Hidden media moved to user preferences; the leftover key only needs clearing
// once per session, not on every call. Client-only, so the module-level flag is
// never shared between SSR requests.
let legacyStorageCleared = false;

/**
 * A stored entry is `{ mediaPublicId }`. It used to carry `nameEn`, `nameJa` and
 * `nameRomaji` too, and still does on a row an old container wrote back during a
 * deploy -- harmless, since only the id is ever asked for. Bare strings are read
 * as well: `hiddenMedia` is meant to become one once no old client is left, and
 * a reader that already accepts it is what makes that a backend-only change.
 *
 * Emptying this list is the one outcome worth defending against: it would hand
 * the reader back every search result they deliberately hid.
 */
function toMediaPublicId(entry: unknown): string | null {
  if (typeof entry === 'string') return entry || null;
  const id = (entry as { mediaPublicId?: unknown } | null)?.mediaPublicId;
  return typeof id === 'string' && id ? id : null;
}

export function useHiddenMedia() {
  const user = userStore();

  if (import.meta.client && !legacyStorageCleared) {
    legacyStorageCleared = true;
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  }

  const hiddenMediaIds = computed<string[]>(() => {
    if (!user.isLoggedIn) return [];
    const raw = user.preferences?.hiddenMedia;
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).map(toMediaPublicId).filter((id): id is string => id !== null);
  });

  const hiddenMediaExcludeFilter = computed<MediaFilterItem[]>(() =>
    hiddenMediaIds.value.map((mediaPublicId) => ({ mediaPublicId })),
  );

  const isMediaHidden = (mediaPublicId: string): boolean => hiddenMediaIds.value.includes(mediaPublicId);

  /**
   * Returns whether the change reached the server, for callers that confirm it.
   * The failure path rolls back and reports itself, so without this a caller
   * cannot tell a saved change from one that was undone under it.
   *
   * Takes the whole media row because the callers have one in hand; the names on
   * it are no longer stored, and the settings table resolves them from
   * `/v1/user/excluded-media` instead.
   *
   * No `hiddenAt` either. This composable used to stamp one, but no write path
   * ever sent it: the endpoint below does not take it, and nothing PATCHes this
   * list. It survived a page load in exactly nobody's row, so the settings list
   * that "ordered by it" was really ordering every hidden title at epoch. Its
   * removal loses no stored data.
   */
  const toggleHideMedia = async (media: {
    publicId: string;
    nameEn?: string;
    nameJa?: string;
    nameRomaji?: string;
  }): Promise<boolean> => {
    if (!user.isLoggedIn) return false;

    const isUnhiding = hiddenMediaIds.value.includes(media.publicId);
    const previousItems = user.preferences?.hiddenMedia;
    // Rebuilt from the ids rather than spliced into the stored array, so an
    // optimistic update also normalizes whatever shape the row arrived in.
    const nextItems: HiddenMediaItem[] = (
      isUnhiding
        ? hiddenMediaIds.value.filter((id) => id !== media.publicId)
        : [...hiddenMediaIds.value, media.publicId]
    ).map((mediaPublicId) => ({ mediaPublicId }));

    user.preferences = {
      ...(user.preferences ?? {}),
      hiddenMedia: nextItems,
    };

    let saved = true;
    try {
      const sdk = useNadeshikoSdk();
      if (isUnhiding) {
        await sdk.removeExcludedMedia({ mediaPublicId: media.publicId });
      } else {
        await sdk.addExcludedMedia({ mediaPublicId: media.publicId });
      }
    } catch (error) {
      // Roll the optimistic update back: leaving it would show the media as hidden
      // while every other device -- and the next page load -- still shows it.
      user.preferences = {
        ...(user.preferences ?? {}),
        hiddenMedia: previousItems,
      };
      handleApiError('hidden-media:toggle-failed', error, {
        toastKey: 'hiddenMedia.updateError',
        context: { 'media.publicId': media.publicId, action: isUnhiding ? 'unhide' : 'hide' },
      });
      saved = false;
    }

    // Bumped either way: a rollback changes the list the search is drawn from
    // just as much as a successful toggle does.
    const forceSearchCounter = useState('force-search-counter', () => 0);
    forceSearchCounter.value++;

    return saved;
  };

  return {
    hiddenMediaIds,
    hiddenMediaExcludeFilter,
    isMediaHidden,
    toggleHideMedia,
  };
}
