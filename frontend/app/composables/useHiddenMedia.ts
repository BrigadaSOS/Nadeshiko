import type { UserPreferences } from '@brigadasos/nadeshiko-sdk';
import type { MediaFilterItem } from '~/types/search';

type SdkHiddenMediaItem = NonNullable<UserPreferences['hiddenMedia']>[number];

export type HiddenMediaItem = SdkHiddenMediaItem & {
  hiddenAt: string;
};

const LEGACY_LOCAL_STORAGE_KEY = 'nadeshiko.hiddenMedia';

export function useHiddenMedia() {
  const user = userStore();

  if (import.meta.client) {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  }

  const items = computed<HiddenMediaItem[]>(() => {
    if (!user.isLoggedIn) return [];
    const raw = user.preferences?.hiddenMedia;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item: any) => item && typeof item === 'object' && typeof item.mediaPublicId === 'string');
  });

  const hiddenMediaIds = computed<string[]>(() => items.value.map((item) => item.mediaPublicId));

  const hiddenMediaExcludeFilter = computed<MediaFilterItem[]>(() =>
    items.value.map((item) => ({ mediaPublicId: item.mediaPublicId })),
  );

  const isMediaHidden = (mediaPublicId: string): boolean => {
    return items.value.some((item) => item.mediaPublicId === mediaPublicId);
  };

  const toggleHideMedia = async (media: {
    publicId: string;
    nameEn?: string;
    nameJa?: string;
    nameRomaji?: string;
  }) => {
    if (!user.isLoggedIn) return;

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

    user.preferences = {
      ...(user.preferences ?? {}),
      hiddenMedia: nextItems,
    };

    try {
      const sdk = useNadeshikoSdk();
      if (isUnhiding) {
        await sdk.removeExcludedMedia({ mediaPublicId: media.publicId });
      } else {
        await sdk.addExcludedMedia({ mediaPublicId: media.publicId });
      }
    } catch {
      // Revert on failure by re-fetching would be ideal, but keep optimistic update for now
    }

    const forceSearchCounter = useState('force-search-counter', () => 0);
    forceSearchCounter.value++;
  };

  return {
    items,
    hiddenMediaIds,
    hiddenMediaExcludeFilter,
    isMediaHidden,
    toggleHideMedia,
  };
}
