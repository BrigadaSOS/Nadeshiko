import type { MediaFilterItem } from '~/types/search';

export type HiddenMediaItem = {
  mediaId: number;
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
    return raw.filter((item: any) => item && typeof item === 'object' && typeof item.mediaId === 'number');
  });

  const hiddenMediaIds = computed<number[]>(() => items.value.map((item) => item.mediaId));

  const hiddenMediaExcludeFilter = computed<MediaFilterItem[]>(() =>
    items.value.map((item) => ({ mediaId: item.mediaId })),
  );

  const isMediaHidden = (mediaId: number): boolean => {
    return items.value.some((item) => item.mediaId === mediaId);
  };

  const toggleHideMedia = async (media: { id: number; nameEn?: string; nameJa?: string; nameRomaji?: string }) => {
    if (!user.isLoggedIn) return;

    const existing = items.value.findIndex((item) => item.mediaId === media.id);
    let nextItems: HiddenMediaItem[];

    if (existing >= 0) {
      nextItems = items.value.filter((_, i) => i !== existing);
    } else {
      nextItems = [
        ...items.value,
        {
          mediaId: media.id,
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
        body: { hiddenMedia: nextItems },
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
