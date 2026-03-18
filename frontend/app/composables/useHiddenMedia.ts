import type { MediaFilterItem } from '~/types/search';

export type HiddenMediaItem = {
  mediaPublicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
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
    items.value.map((item) => ({ mediaId: item.mediaPublicId })),
  );

  const isMediaHidden = (mediaPublicId: string): boolean => {
    return items.value.some((item) => item.mediaPublicId === mediaPublicId);
  };

  const toggleHideMedia = async (media: { publicId: string; nameEn?: string; nameJa?: string; nameRomaji?: string }) => {
    if (!user.isLoggedIn) return;

    const existing = items.value.findIndex((item) => item.mediaPublicId === media.publicId);
    let nextItems: HiddenMediaItem[];

    if (existing >= 0) {
      nextItems = items.value.filter((_, i) => i !== existing);
    } else {
      nextItems = [
        ...items.value,
        {
          mediaPublicId: media.publicId,
          nameEn: media.nameEn,
          nameJa: media.nameJa,
          nameRomaji: media.nameRomaji,
          hiddenAt: new Date().toISOString(),
        },
      ];
    }

    user.preferences = {
      ...(user.preferences ?? {}),
      hiddenMedia: nextItems,
    };

    try {
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({
        body: { hiddenMedia: nextItems } as any,
      });
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
