import { authApiRequest } from '~/utils/authApi';

type TranslationPrefKey = 'showEnglish' | 'showSpanish';

export type TranslationVisibilityPreferences = {
  showEnglish: boolean;
  showSpanish: boolean;
  updatedAt: string;
};

const LOCAL_STORAGE_KEY = 'nadeshiko.translationVisibilityPreferences';
const USER_PREFS_KEY = 'translationVisibilityPreferences';

const defaultPreferences = (): TranslationVisibilityPreferences => ({
  showEnglish: true,
  showSpanish: true,
  updatedAt: '',
});

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizePreferences(raw: unknown): TranslationVisibilityPreferences {
  const base = defaultPreferences();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const source = raw as Partial<TranslationVisibilityPreferences>;
  return {
    showEnglish: typeof source.showEnglish === 'boolean' ? source.showEnglish : base.showEnglish,
    showSpanish: typeof source.showSpanish === 'boolean' ? source.showSpanish : base.showSpanish,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : base.updatedAt,
  };
}

function readGuestPreferences(): { exists: boolean; prefs: TranslationVisibilityPreferences } {
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

function writeGuestPreferences(prefs: TranslationVisibilityPreferences): void {
  if (import.meta.server) return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
}

export function useTranslationVisibility() {
  const user = userStore();

  const prefs = useState<TranslationVisibilityPreferences>('translation-visibility-prefs', defaultPreferences);
  const initialized = useState<boolean>('translation-visibility-initialized', () => false);
  const watchersReady = useState<boolean>('translation-visibility-watchers-ready', () => false);
  const syncing = useState<boolean>('translation-visibility-syncing', () => false);

  const getServerPreferences = () => normalizePreferences(user.preferences?.[USER_PREFS_KEY]);

  const setUserStorePreferences = (next: TranslationVisibilityPreferences) => {
    user.preferences = {
      ...(user.preferences ?? {}),
      [USER_PREFS_KEY]: next,
    };
  };

  const persistToServer = async (next: TranslationVisibilityPreferences): Promise<boolean> => {
    const response = await authApiRequest('/v1/user/preferences', {
      method: 'PATCH',
      body: { [USER_PREFS_KEY]: next },
    });

    if (!response.ok) {
      return false;
    }

    setUserStorePreferences(next);
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

  const updatePreference = async (key: TranslationPrefKey, value: boolean) => {
    if (import.meta.server) return;

    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [key]: value,
      updatedAt: new Date().toISOString(),
    };

    prefs.value = next;
    writeGuestPreferences(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
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

  const showEnglish = computed(() => prefs.value.showEnglish);
  const showSpanish = computed(() => prefs.value.showSpanish);
  const hasVisibleTranslations = computed(() => showEnglish.value || showSpanish.value);

  const setShowEnglish = (value: boolean) => updatePreference('showEnglish', value);
  const setShowSpanish = (value: boolean) => updatePreference('showSpanish', value);

  return {
    prefs,
    showEnglish,
    showSpanish,
    hasVisibleTranslations,
    setShowEnglish,
    setShowSpanish,
  };
}
