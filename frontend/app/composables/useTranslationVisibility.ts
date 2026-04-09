export type TranslationVisibilityMode = 'show' | 'spoiler' | 'hidden';

type TranslationVisibilityPreferences = {
  englishMode: TranslationVisibilityMode;
  spanishMode: TranslationVisibilityMode;
};

const USER_PREFS_KEY = 'translationVisibilityPreferences';
const COOKIE_NAME = 'nd_lang_prefs';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const defaultPreferences = (): TranslationVisibilityPreferences => ({
  englishMode: 'show',
  spanishMode: 'show',
});

function isValidMode(value: unknown): value is TranslationVisibilityMode {
  return value === 'show' || value === 'spoiler' || value === 'hidden';
}

function nextMode(current: TranslationVisibilityMode): TranslationVisibilityMode {
  if (current === 'show') return 'spoiler';
  if (current === 'spoiler') return 'hidden';
  return 'show';
}

function normalizePreferences(raw: unknown): TranslationVisibilityPreferences {
  const base = defaultPreferences();
  if (!raw || typeof raw !== 'object') {
    return base;
  }

  const source = raw as Record<string, unknown>;
  return {
    englishMode: isValidMode(source.englishMode) ? source.englishMode : base.englishMode,
    spanishMode: isValidMode(source.spanishMode) ? source.spanishMode : base.spanishMode,
  };
}

function encodeCookie(prefs: TranslationVisibilityPreferences): string {
  const parts: string[] = [];
  if (prefs.englishMode !== 'show') parts.push(`en:${prefs.englishMode}`);
  if (prefs.spanishMode !== 'show') parts.push(`es:${prefs.spanishMode}`);
  return parts.join(',');
}

function decodeCookie(value: string | null | undefined): TranslationVisibilityPreferences {
  const result = defaultPreferences();
  if (!value) return result;

  for (const part of value.split(',')) {
    const [lang, mode] = part.split(':');
    if (lang === 'en' && isValidMode(mode)) result.englishMode = mode;
    if (lang === 'es' && isValidMode(mode)) result.spanishMode = mode;
  }
  return result;
}

export function useTranslationVisibility() {
  const user = userStore();

  const prefs = useState<TranslationVisibilityPreferences>('translation-visibility-prefs', defaultPreferences);
  const initialized = useState<boolean>('translation-visibility-initialized', () => false);
  const watchersReady = useState<boolean>('translation-visibility-watchers-ready', () => false);

  const langCookie = useCookie(COOKIE_NAME, {
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    encode: String,
    decode: String,
  });

  const syncCookie = (p: TranslationVisibilityPreferences) => {
    const encoded = encodeCookie(p);
    langCookie.value = encoded || null;
  };

  const getServerPreferences = () => normalizePreferences(user.preferences?.[USER_PREFS_KEY]);

  const persistToServer = async (next: TranslationVisibilityPreferences): Promise<boolean> => {
    try {
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({
        body: { [USER_PREFS_KEY]: next } as Record<string, unknown>,
      });
      user.preferences = {
        ...(user.preferences ?? {}),
        [USER_PREFS_KEY]: next,
      };
      return true;
    } catch {
      return false;
    }
  };

  // SSR: always read from cookie (works for both guests and logged-in users)
  if (import.meta.server) {
    prefs.value = decodeCookie(langCookie.value);
    initialized.value = true;
  } else if (!initialized.value) {
    // Client init: logged-in users get DB prefs, guests get cookie
    if (user.isLoggedIn) {
      const dbPrefs = getServerPreferences();
      prefs.value = dbPrefs;
      syncCookie(dbPrefs);
    } else {
      prefs.value = decodeCookie(langCookie.value);
    }
    initialized.value = true;
  }

  const updateModePreference = async (key: 'englishMode' | 'spanishMode', mode: TranslationVisibilityMode) => {
    if (import.meta.server) return;

    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [key]: mode,
    };

    prefs.value = next;
    syncCookie(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
    }
  };

  if (import.meta.client && !watchersReady.value) {
    watchersReady.value = true;

    // On login: DB prefs always win, but only after preferences are actually loaded
    // to avoid race condition where defaults overwrite cookie before DB response arrives
    watch(
      () => user.isLoggedIn,
      (loggedIn) => {
        if (!loggedIn) return;
        // Wait for preferences to be loaded from server before syncing
        watch(
          () => user.preferences,
          (loadedPrefs) => {
            if (loadedPrefs === null || loadedPrefs === undefined) return;
            const dbPrefs = getServerPreferences();
            prefs.value = dbPrefs;
            syncCookie(dbPrefs);
          },
          { once: true },
        );
      },
    );

    // If server prefs change externally, sync them down
    watch(
      () => user.preferences?.[USER_PREFS_KEY],
      () => {
        if (!user.isLoggedIn) return;
        const dbPrefs = getServerPreferences();
        prefs.value = dbPrefs;
        syncCookie(dbPrefs);
      },
      { deep: true },
    );
  }

  const englishMode = computed(() => prefs.value.englishMode);
  const spanishMode = computed(() => prefs.value.spanishMode);
  const excludedLanguages = computed<Array<'en' | 'es'>>(() => {
    const excluded: Array<'en' | 'es'> = [];
    if (englishMode.value === 'hidden') excluded.push('en');
    if (spanishMode.value === 'hidden') excluded.push('es');
    return excluded;
  });

  const cycleEnglishMode = () => updateModePreference('englishMode', nextMode(englishMode.value));
  const cycleSpanishMode = () => updateModePreference('spanishMode', nextMode(spanishMode.value));

  return {
    englishMode,
    spanishMode,
    excludedLanguages,
    cycleEnglishMode,
    cycleSpanishMode,
  };
}
