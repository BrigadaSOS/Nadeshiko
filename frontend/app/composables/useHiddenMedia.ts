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
 * Accept bare ids, id-only objects, and legacy objects carrying names. Dropping stored
 * exclusions would restore results the reader deliberately hid.
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
   * Return whether the server saved the toggle; failure rolls back and reports itself. Callers
   * may pass names, but only the id is stored; settings resolve names via
   * /v1/user/excluded-media.
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
