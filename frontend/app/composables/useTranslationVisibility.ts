export type TranslationVisibilityMode = 'show' | 'spoiler' | 'hidden';

type LanguageCode = 'EN' | 'ES';

type TranslationVisibilityPreferences = Partial<Record<LanguageCode, TranslationVisibilityMode>>;

const USER_PREFS_KEY = 'translationVisibilityPreferences';
const COOKIE_NAME = 'nd_lang_prefs';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Cookie uses lowercase ISO codes for compactness and to preserve backward
// compatibility with cookies set before the EN/ES rename.
const COOKIE_KEY_BY_CODE: Record<LanguageCode, string> = { EN: 'en', ES: 'es' };
const CODE_BY_COOKIE_KEY: Record<string, LanguageCode> = { en: 'EN', es: 'ES' };

const LANGUAGE_CODES: readonly LanguageCode[] = ['EN', 'ES'];

const defaultPreferences = (): TranslationVisibilityPreferences => ({});

function isValidMode(value: unknown): value is TranslationVisibilityMode {
  return value === 'show' || value === 'spoiler' || value === 'hidden';
}

function modeOf(prefs: TranslationVisibilityPreferences, code: LanguageCode): TranslationVisibilityMode {
  return prefs[code] ?? 'show';
}

function nextMode(current: TranslationVisibilityMode): TranslationVisibilityMode {
  if (current === 'show') return 'spoiler';
  if (current === 'spoiler') return 'hidden';
  return 'show';
}

function normalizePreferences(raw: unknown): TranslationVisibilityPreferences {
  if (!raw || typeof raw !== 'object') return defaultPreferences();
  const source = raw as Record<string, unknown>;
  const result: TranslationVisibilityPreferences = {};
  for (const code of LANGUAGE_CODES) {
    const value = source[code];
    if (isValidMode(value)) result[code] = value;
  }
  return result;
}

function encodeCookie(prefs: TranslationVisibilityPreferences): string {
  const parts: string[] = [];
  for (const code of LANGUAGE_CODES) {
    const mode = prefs[code];
    if (mode && mode !== 'show') {
      parts.push(`${COOKIE_KEY_BY_CODE[code]}:${mode}`);
    }
  }
  return parts.join(',');
}

function decodeCookie(value: string | null | undefined): TranslationVisibilityPreferences {
  const result = defaultPreferences();
  if (!value) return result;

  for (const part of value.split(',')) {
    const [cookieKey, mode] = part.split(':');
    const code = cookieKey ? CODE_BY_COOKIE_KEY[cookieKey] : undefined;
    if (code && isValidMode(mode)) result[code] = mode;
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
      await sdk.updateUserPreferences({ [USER_PREFS_KEY]: next } as Record<string, unknown>);
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
    // Client init: logged-in users get DB prefs (if saved), otherwise cookie
    if (user.isLoggedIn && user.preferences?.[USER_PREFS_KEY] != null) {
      const dbPrefs = getServerPreferences();
      prefs.value = dbPrefs;
      syncCookie(dbPrefs);
    } else {
      prefs.value = decodeCookie(langCookie.value);
    }
    initialized.value = true;
  }

  const updateModePreference = async (code: LanguageCode, mode: TranslationVisibilityMode) => {
    if (import.meta.server) return;

    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [code]: mode,
    };

    prefs.value = next;
    syncCookie(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
    }
  };

  if (import.meta.client && !watchersReady.value) {
    watchersReady.value = true;

    watch(
      () => user.preferences?.[USER_PREFS_KEY],
      (newVal) => {
        if (!user.isLoggedIn) return;
        if (newVal === undefined || newVal === null) return;
        const dbPrefs = getServerPreferences();
        prefs.value = dbPrefs;
        syncCookie(dbPrefs);
      },
      { deep: true },
    );
  }

  const englishMode = computed(() => modeOf(prefs.value, 'EN'));
  const spanishMode = computed(() => modeOf(prefs.value, 'ES'));
  const includedLanguages = computed<LanguageCode[] | undefined>(() => {
    const englishHidden = englishMode.value === 'hidden';
    const spanishHidden = spanishMode.value === 'hidden';
    if (!englishHidden && !spanishHidden) return undefined;
    const included: LanguageCode[] = [];
    if (!englishHidden) included.push('EN');
    if (!spanishHidden) included.push('ES');
    return included;
  });

  const cycleEnglishMode = () => updateModePreference('EN', nextMode(englishMode.value));
  const cycleSpanishMode = () => updateModePreference('ES', nextMode(spanishMode.value));

  return {
    englishMode,
    spanishMode,
    includedLanguages,
    cycleEnglishMode,
    cycleSpanishMode,
  };
}
