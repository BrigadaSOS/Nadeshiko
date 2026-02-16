import { authApiRequest } from '~/utils/authApi';
import type { MediaFilterItem } from '~/stores/search';

export type HiddenMediaItem = {
  mediaId: number;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
  hiddenAt: string;
};

export type HiddenMediaPreferences = {
  items: HiddenMediaItem[];
  updatedAt: string;
};

const LOCAL_STORAGE_KEY = 'nadeshiko.hiddenMedia';
const USER_PREFS_KEY = 'hiddenMedia';

const defaultPreferences = (): HiddenMediaPreferences => ({
  items: [],
  updatedAt: '',
});

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizePreferences(raw: unknown): HiddenMediaPreferences {
  const base = defaultPreferences();
  if (!raw || typeof raw !== 'object') return base;

  // Handle both formats: raw array (server JSONB) and wrapped object (localStorage)
  if (Array.isArray(raw)) {
    return {
      items: raw.filter((item) => item && typeof item === 'object' && typeof item.mediaId === 'number'),
      updatedAt: '',
    };
  }

  const source = raw as Partial<HiddenMediaPreferences>;
  return {
    items: Array.isArray(source.items)
      ? source.items.filter((item) => item && typeof item.mediaId === 'number')
      : base.items,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : base.updatedAt,
  };
}

function readGuestPreferences(): { exists: boolean; prefs: HiddenMediaPreferences } {
  if (import.meta.server) {
    return { exists: false, prefs: defaultPreferences() };
  }

  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    return { exists: false, prefs: defaultPreferences() };
  }

  try {
    return {
      exists: true,
      prefs: normalizePreferences(JSON.parse(raw)),
    };
  } catch {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    return { exists: false, prefs: defaultPreferences() };
  }
}

function writeGuestPreferences(prefs: HiddenMediaPreferences): void {
  if (import.meta.server) return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
}

export function useHiddenMedia() {
  const user = userStore();

  const prefs = useState<HiddenMediaPreferences>('hidden-media-prefs', defaultPreferences);
  const initialized = useState<boolean>('hidden-media-initialized', () => false);
  const watchersReady = useState<boolean>('hidden-media-watchers-ready', () => false);
  const syncing = useState<boolean>('hidden-media-syncing', () => false);

  const getServerPreferences = (): HiddenMediaPreferences => normalizePreferences(user.preferences?.[USER_PREFS_KEY]);

  const setUserStorePreferences = (items: HiddenMediaItem[]) => {
    user.preferences = {
      ...(user.preferences ?? {}),
      [USER_PREFS_KEY]: items,
    };
  };

  const persistToServer = async (next: HiddenMediaPreferences): Promise<boolean> => {
    const response = await authApiRequest('/v1/user/preferences', {
      method: 'PATCH',
      body: { [USER_PREFS_KEY]: next.items },
    });

    if (!response.ok) return false;
    setUserStorePreferences(next.items);
    return true;
  };

  if (!initialized.value) {
    if (user.isLoggedIn) {
      prefs.value = getServerPreferences();
    } else if (import.meta.client) {
      prefs.value = readGuestPreferences().prefs;
    }
    initialized.value = true;
  }

  const syncOnLogin = async () => {
    if (import.meta.server || syncing.value || !user.isLoggedIn) return;

    syncing.value = true;
    try {
      const guest = readGuestPreferences();
      const serverPrefs = getServerPreferences();

      if (!guest.exists) {
        prefs.value = serverPrefs;
        writeGuestPreferences(serverPrefs);
        return;
      }

      const guestTs = parseTimestamp(guest.prefs.updatedAt);
      const serverTs = parseTimestamp(serverPrefs.updatedAt);

      if (guestTs > serverTs) {
        prefs.value = guest.prefs;
        await persistToServer(guest.prefs);
        return;
      }

      prefs.value = serverPrefs;
      writeGuestPreferences(serverPrefs);
    } finally {
      syncing.value = false;
    }
  };

  if (import.meta.client && !watchersReady.value) {
    watchersReady.value = true;

    watch(
      () => user.isLoggedIn,
      async (loggedIn) => {
        if (loggedIn) {
          await syncOnLogin();
          return;
        }
        prefs.value = readGuestPreferences().prefs;
      },
      { immediate: true },
    );

    watch(
      () => user.preferences?.[USER_PREFS_KEY],
      () => {
        if (!user.isLoggedIn) return;
        const serverPrefs = getServerPreferences();
        prefs.value = serverPrefs;
        writeGuestPreferences(serverPrefs);
      },
      { deep: true },
    );
  }

  const hiddenMediaIds = computed<number[]>(() => prefs.value.items.map((item) => item.mediaId));

  const hiddenMediaExcludeFilter = computed<MediaFilterItem[]>(() =>
    prefs.value.items.map((item) => ({ mediaId: item.mediaId })),
  );

  const isMediaHidden = (mediaId: number): boolean => {
    return prefs.value.items.some((item) => item.mediaId === mediaId);
  };

  const toggleHideMedia = async (media: { mediaId: number; nameEn?: string; nameJa?: string; nameRomaji?: string }) => {
    if (import.meta.server) return;

    const existing = prefs.value.items.findIndex((item) => item.mediaId === media.mediaId);
    let nextItems: HiddenMediaItem[];

    if (existing >= 0) {
      nextItems = prefs.value.items.filter((_, i) => i !== existing);
    } else {
      nextItems = [
        ...prefs.value.items,
        {
          mediaId: media.mediaId,
          nameEn: media.nameEn,
          nameJa: media.nameJa,
          nameRomaji: media.nameRomaji,
          hiddenAt: new Date().toISOString(),
        },
      ];
    }

    const next: HiddenMediaPreferences = {
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };

    prefs.value = next;
    writeGuestPreferences(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
    }
  };

  return {
    prefs,
    hiddenMediaIds,
    hiddenMediaExcludeFilter,
    isMediaHidden,
    toggleHideMedia,
  };
}
