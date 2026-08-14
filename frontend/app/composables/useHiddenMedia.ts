import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import type { MediaFilterItem } from '~/types/search';
import { handleApiError } from '~/utils/apiError';

type SdkHiddenMediaItem = NonNullable<UserPreferences['hiddenMedia']>[number];

export type HiddenMediaItem = SdkHiddenMediaItem & {
  hiddenAt: string;
};

const LEGACY_LOCAL_STORAGE_KEY = 'nadeshiko.hiddenMedia';

// Hidden media moved to user preferences; the leftover key only needs clearing
// once per session, not on every call. Client-only, so the module-level flag is
// never shared between SSR requests.
let legacyStorageCleared = false;

export function useHiddenMedia() {
  const user = userStore();

  if (import.meta.client && !legacyStorageCleared) {
    legacyStorageCleared = true;
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  }

  const items = computed<HiddenMediaItem[]>(() => {
    if (!user.isLoggedIn) return [];
    const raw = user.preferences?.hiddenMedia;
    if (!Array.isArray(raw)) return [];
    // The API type has no `hiddenAt`; the predicate states what this composable
    // has always assumed about stored entries, which the `any` here used to hide.
    return raw.filter(
      (item): item is HiddenMediaItem => !!item && typeof item === 'object' && typeof item.mediaPublicId === 'string',
    );
  });

  const hiddenMediaIds = computed<string[]>(() => items.value.map((item) => item.mediaPublicId));

  const hiddenMediaExcludeFilter = computed<MediaFilterItem[]>(() =>
    items.value.map((item) => ({ mediaPublicId: item.mediaPublicId })),
  );

  const isMediaHidden = (mediaPublicId: string): boolean => {
    return items.value.some((item) => item.mediaPublicId === mediaPublicId);
  };

  /**
   * Returns whether the change reached the server, for callers that confirm it.
   * The failure path rolls back and reports itself, so without this a caller
   * cannot tell a saved change from one that was undone under it.
   */
  const toggleHideMedia = async (media: {
    publicId: string;
    nameEn?: string;
    nameJa?: string;
    nameRomaji?: string;
  }): Promise<boolean> => {
    if (!user.isLoggedIn) return false;

    const existing = items.value.findIndex((item) => item.mediaPublicId === media.publicId);
    const isUnhiding = existing >= 0;
    const nextItems: HiddenMediaItem[] = isUnhiding
      ? items.value.filter((_, i) => i !== existing)
      : [
          ...items.value,
          {
            mediaPublicId: media.publicId,
            nameEn: media.nameEn,
            nameJa: media.nameJa,
            nameRomaji: media.nameRomaji,
            hiddenAt: new Date().toISOString(),
          },
        ];

    const previousItems = items.value;
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
    items,
    hiddenMediaIds,
    hiddenMediaExcludeFilter,
    isMediaHidden,
    toggleHideMedia,
  };
}
