import { authApiRequest } from '~/utils/authApi';

type TranslationPrefKey = 'showEnglish' | 'showSpanish';
type TranslationModePrefKey = 'englishMode' | 'spanishMode';
export type TranslationVisibilityMode = 'show' | 'spoiler' | 'hidden';

export type TranslationVisibilityPreferences = {
  showEnglish: boolean;
  showSpanish: boolean;
  englishMode: TranslationVisibilityMode;
  spanishMode: TranslationVisibilityMode;
  updatedAt: string;
};

const LOCAL_STORAGE_KEY = 'nadeshiko.translationVisibilityPreferences';
const USER_PREFS_KEY = 'translationVisibilityPreferences';

const defaultPreferences = (): TranslationVisibilityPreferences => ({
  showEnglish: true,
  showSpanish: true,
  englishMode: 'show',
  spanishMode: 'show',
  updatedAt: '',
});

function normalizeMode(value: unknown, fallback: TranslationVisibilityMode): TranslationVisibilityMode {
  if (value === 'show' || value === 'spoiler' || value === 'hidden') {
    return value;
  }
  return fallback;
}

function modeToShowFlag(mode: TranslationVisibilityMode): boolean {
  return mode !== 'hidden';
}

function nextMode(current: TranslationVisibilityMode): TranslationVisibilityMode {
  if (current === 'show') return 'spoiler';
  if (current === 'spoiler') return 'hidden';
  return 'show';
}

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
  const legacyShowEnglish = typeof source.showEnglish === 'boolean' ? source.showEnglish : undefined;
  const legacyShowSpanish = typeof source.showSpanish === 'boolean' ? source.showSpanish : undefined;
  const englishMode = normalizeMode(source.englishMode, legacyShowEnglish === false ? 'hidden' : base.englishMode);
  const spanishMode = normalizeMode(source.spanishMode, legacyShowSpanish === false ? 'hidden' : base.spanishMode);

  return {
    showEnglish: modeToShowFlag(englishMode),
    showSpanish: modeToShowFlag(spanishMode),
    englishMode,
    spanishMode,
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

  if (import.meta.server) {
    const base = user.isLoggedIn ? getServerPreferences() : defaultPreferences();
    const route = useRoute();
    const hideLangs = typeof route.query.hideLangs === 'string'
      ? route.query.hideLangs.split(',').filter((l: string) => l === 'en' || l === 'es')
      : [];
    const blurLangs = typeof route.query.blurLangs === 'string'
      ? route.query.blurLangs.split(',').filter((l: string) => l === 'en' || l === 'es')
      : [];
    if (hideLangs.includes('en')) {
      base.englishMode = 'hidden';
      base.showEnglish = false;
    } else if (blurLangs.includes('en')) {
      base.englishMode = 'spoiler';
      base.showEnglish = true;
    }
    if (hideLangs.includes('es')) {
      base.spanishMode = 'hidden';
      base.showSpanish = false;
    } else if (blurLangs.includes('es')) {
      base.spanishMode = 'spoiler';
      base.showSpanish = true;
    }
    prefs.value = base;
  } else if (!initialized.value) {
    if (user.isLoggedIn) {
      prefs.value = getServerPreferences();
    } else {
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

    const nextModeValue: TranslationVisibilityMode = value ? 'show' : 'hidden';
    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [key]: value,
      ...(key === 'showEnglish' ? { englishMode: nextModeValue } : { spanishMode: nextModeValue }),
      updatedAt: new Date().toISOString(),
    };

    prefs.value = next;
    writeGuestPreferences(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
    }
  };

  const updateModePreference = async (key: TranslationModePrefKey, mode: TranslationVisibilityMode) => {
    if (import.meta.server) return;

    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [key]: mode,
      ...(key === 'englishMode' ? { showEnglish: modeToShowFlag(mode) } : { showSpanish: modeToShowFlag(mode) }),
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
  const englishMode = computed(() => prefs.value.englishMode);
  const spanishMode = computed(() => prefs.value.spanishMode);
  const hasVisibleTranslations = computed(() => englishMode.value !== 'hidden' || spanishMode.value !== 'hidden');
  const excludedLanguages = computed(() => {
    const excluded: string[] = [];
    if (englishMode.value === 'hidden') excluded.push('en');
    if (spanishMode.value === 'hidden') excluded.push('es');
    return excluded;
  });

  const blurredLanguages = computed(() => {
    const blurred: string[] = [];
    if (englishMode.value === 'spoiler') blurred.push('en');
    if (spanishMode.value === 'spoiler') blurred.push('es');
    return blurred;
  });

  const setShowEnglish = (value: boolean) => updatePreference('showEnglish', value);
  const setShowSpanish = (value: boolean) => updatePreference('showSpanish', value);
  const setEnglishMode = (mode: TranslationVisibilityMode) => updateModePreference('englishMode', mode);
  const setSpanishMode = (mode: TranslationVisibilityMode) => updateModePreference('spanishMode', mode);
  const cycleEnglishMode = () => setEnglishMode(nextMode(englishMode.value));
  const cycleSpanishMode = () => setSpanishMode(nextMode(spanishMode.value));

  return {
    prefs,
    showEnglish,
    showSpanish,
    englishMode,
    spanishMode,
    hasVisibleTranslations,
    excludedLanguages,
    blurredLanguages,
    setShowEnglish,
    setShowSpanish,
    setEnglishMode,
    setSpanishMode,
    cycleEnglishMode,
    cycleSpanishMode,
  };
}
