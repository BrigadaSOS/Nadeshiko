import { type EffectScope, effectScope } from 'vue';
import { handleApiError } from '~/utils/apiError';
import { LANG_PREFS_COOKIE } from '#shared/utils/preferenceCookies';

export type TranslationVisibilityMode = 'show' | 'spoiler' | 'hidden';

type LanguageCode = 'EN' | 'ES';

type TranslationVisibilityPreferences = Partial<Record<LanguageCode, TranslationVisibilityMode>>;

const USER_PREFS_KEY = 'translationVisibilityPreferences';
// See `shared/utils/preferenceCookies.ts`: read during SSR, so it is a cache key.
const COOKIE_NAME = LANG_PREFS_COOKIE;

// Cookie uses lowercase ISO codes for compactness and to preserve backward
// compatibility with cookies set before the EN/ES rename.
const COOKIE_KEY_BY_CODE: Record<LanguageCode, string> = { EN: 'en', ES: 'es' };
const CODE_BY_COOKIE_KEY: Record<string, LanguageCode> = { en: 'EN', es: 'ES' };

const LANGUAGE_CODES: readonly LanguageCode[] = ['EN', 'ES'];

// Holds the "user preferences changed" watcher. Client-only: on the server a
// module-level scope would be shared by every request.
let dbSyncScope: EffectScope | null = null;

const defaultPreferences = (): TranslationVisibilityPreferences => ({});

function isValidMode(value: unknown): value is TranslationVisibilityMode {
  return value === 'show' || value === 'spoiler' || value === 'hidden';
}

function modeOf(prefs: TranslationVisibilityPreferences, code: LanguageCode): TranslationVisibilityMode {
  return prefs[code] ?? 'show';
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
  const { languages: translationLanguages } = useTranslationLanguages();

  const {
    state: prefs,
    cookie: langCookie,
    set: setPrefs,
  } = useCookiePreference<TranslationVisibilityPreferences>(COOKIE_NAME, 'translation-visibility-prefs', {
    parse: decodeCookie,
    serialize: (p) => encodeCookie(p) || null,
  });

  const initialized = useState<boolean>('translation-visibility-initialized', () => false);

  const getServerPreferences = () => normalizePreferences(user.preferences?.[USER_PREFS_KEY]);

  const persistToServer = async (next: TranslationVisibilityPreferences): Promise<boolean> => {
    try {
      const sdk = useNadeshikoSdk();
      await sdk.updateUserPreferences({ [USER_PREFS_KEY]: next });
      user.preferences = {
        ...(user.preferences ?? {}),
        [USER_PREFS_KEY]: next,
      };
      return true;
    } catch (error) {
      // The cookie was already updated, so the preference holds for this browser --
      // only cross-device persistence is lost. Not worth interrupting the reader.
      handleApiError('translation-visibility:persist-failed', error, { toastKey: false });
      return false;
    }
  };

  // SSR reads from the cookie for guests and logged-in users alike; that is
  // `useCookiePreference`'s own server pass, so only the flag is left to set.
  if (import.meta.server) {
    initialized.value = true;
  } else if (!initialized.value) {
    // Client init: logged-in users get DB prefs (if saved), otherwise cookie
    if (user.isLoggedIn && user.preferences?.[USER_PREFS_KEY] != null) {
      setPrefs(getServerPreferences());
    } else {
      prefs.value = decodeCookie(langCookie.value ?? null);
    }
    initialized.value = true;
  }

  const updateModePreference = async (code: LanguageCode, mode: TranslationVisibilityMode) => {
    if (import.meta.server) return;
    if (modeOf(prefs.value, code) === mode) return;

    const next: TranslationVisibilityPreferences = {
      ...prefs.value,
      [code]: mode,
    };

    setPrefs(next);

    if (user.isLoggedIn) {
      await persistToServer(next);
    }
  };

  // Registered once, in a detached scope: bound to the calling component it
  // would be torn down as soon as that component unmounts, leaving later
  // preference updates unobserved. The scope owns its own cookie ref for the
  // same reason -- `useCookie`'s writer is scope-bound too.
  if (import.meta.client && !dbSyncScope) {
    dbSyncScope = effectScope(true);
    dbSyncScope.run(() => {
      const scopedCookie = useCookie(COOKIE_NAME, { ...PREFERENCE_COOKIE_OPTIONS });

      watch(
        () => user.preferences?.[USER_PREFS_KEY],
        (newVal) => {
          if (!user.isLoggedIn) return;
          if (newVal === undefined || newVal === null) return;
          const dbPrefs = getServerPreferences();
          prefs.value = dbPrefs;
          scopedCookie.value = encodeCookie(dbPrefs) || null;
        },
        { deep: true },
      );
    });
  }

  const englishMode = computed(() => modeOf(prefs.value, 'EN'));
  const spanishMode = computed(() => modeOf(prefs.value, 'ES'));
  const includedLanguages = computed<LanguageCode[] | undefined>(() => {
    const included = translationLanguages.value.filter(
      (language) => (language === 'EN' ? englishMode.value : spanishMode.value) !== 'hidden',
    );
    // The absent API filter means both languages. Keep that compact default,
    // but always send a global one-language choice.
    return included.length === 2 ? undefined : included;
  });

  const setEnglishMode = (mode: TranslationVisibilityMode) => updateModePreference('EN', mode);
  const setSpanishMode = (mode: TranslationVisibilityMode) => updateModePreference('ES', mode);

  return {
    englishMode,
    spanishMode,
    includedLanguages,
    setEnglishMode,
    setSpanishMode,
  };
}
