import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The per-language show / spoiler / hidden choice.
 *
 * Two things here are worth holding down. The COOKIE is read during SSR and is
 * part of the page cache key, so its encoding is a wire format: a shape change
 * silently reverts every reader to the default on their next visit, and one
 * that grows for the default value would fragment the cache. And the SERVER
 * copy has to win on the client for a signed-in reader, which is the whole
 * point of storing it -- getting that backwards means a preference set on a
 * laptop is ignored on a phone that happens to have any cookie at all.
 */
const cookies = new Map<string, ReturnType<typeof ref<string | null>>>();
const sdk = { updateUserPreferences: vi.fn().mockResolvedValue({}) };
const user = {
  isLoggedIn: false,
  preferences: {} as Record<string, unknown>,
};
/** The global language choice `useTranslationLanguages` resolves to. */
let translationLanguages: ('EN' | 'ES')[] = ['EN', 'ES'];

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);
vi.stubGlobal('useCookie', (name: string) => {
  if (!cookies.has(name)) cookies.set(name, ref<string | null>(null));
  return cookies.get(name)!;
});
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(translationLanguages) }));

/** Re-imports the composable, since it keeps a module-level watcher scope. */
async function loadComposable() {
  vi.resetModules();
  const { useCookiePreference, PREFERENCE_COOKIE_OPTIONS } = await import('./useCookiePreference');
  vi.stubGlobal('useCookiePreference', useCookiePreference);
  vi.stubGlobal('PREFERENCE_COOKIE_OPTIONS', PREFERENCE_COOKIE_OPTIONS);
  return (await import('./useTranslationVisibility')).useTranslationVisibility;
}

const COOKIE_NAME = 'nd_lang_prefs';

/** The raw cookie the composable would send to the browser. */
function cookieValue() {
  return cookies.get(COOKIE_NAME)?.value ?? null;
}

function setCookie(value: string | null) {
  cookies.set(COOKIE_NAME, ref(value));
}

beforeEach(() => {
  vi.clearAllMocks();
  cookies.clear();
  user.isLoggedIn = false;
  user.preferences = {};
  translationLanguages = ['EN', 'ES'];
});

describe('defaults', () => {
  test('both languages show when nothing has ever been set', async () => {
    const useTranslationVisibility = await loadComposable();

    const { englishMode, spanishMode } = useTranslationVisibility();

    expect(englishMode.value).toBe('show');
    expect(spanishMode.value).toBe('show');
  });

  test('no cookie is written for the default, so the page stays on one cache key', async () => {
    const useTranslationVisibility = await loadComposable();

    useTranslationVisibility();

    expect(cookieValue()).toBeNull();
  });
});

describe('the cookie format', () => {
  test.each([
    ['spoiler', 'en:spoiler'],
    ['hidden', 'en:hidden'],
  ])('setting English to %s writes %s', async (mode, expected) => {
    const useTranslationVisibility = await loadComposable();
    const { setEnglishMode } = useTranslationVisibility();

    await setEnglishMode(mode as 'spoiler' | 'hidden');

    expect(cookieValue()).toBe(expected);
  });

  test('both languages ride in one cookie', async () => {
    const useTranslationVisibility = await loadComposable();
    const { setEnglishMode, setSpanishMode } = useTranslationVisibility();

    await setEnglishMode('hidden');
    await setSpanishMode('spoiler');

    expect(cookieValue()).toBe('en:hidden,es:spoiler');
  });

  test('returning a language to `show` drops it from the cookie rather than spelling it out', async () => {
    // `show` is the default, so writing it would give the same reader two
    // different cache keys for the same rendered page.
    const useTranslationVisibility = await loadComposable();
    const { setEnglishMode } = useTranslationVisibility();
    await setEnglishMode('hidden');

    await setEnglishMode('show');

    expect(cookieValue()).toBeNull();
  });

  test('is read back on the next visit', async () => {
    setCookie('en:hidden,es:spoiler');
    const useTranslationVisibility = await loadComposable();

    const { englishMode, spanishMode } = useTranslationVisibility();

    expect(englishMode.value).toBe('hidden');
    expect(spanishMode.value).toBe('spoiler');
  });

  test('uses lowercase codes, which is what cookies written before the EN/ES rename hold', async () => {
    setCookie('en:hidden');
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().englishMode.value).toBe('hidden');
  });

  test.each([
    ['garbage', 'nonsense'],
    ['an unknown mode', 'en:invisible'],
    ['an unknown language', 'fr:hidden'],
    ['a half-written pair', 'en:'],
    ['an empty string', ''],
  ])('%s falls back to the default rather than breaking the page', async (_name, raw) => {
    // Cookies are client-controlled and outlive deploys.
    setCookie(raw);
    const useTranslationVisibility = await loadComposable();

    const { englishMode, spanishMode } = useTranslationVisibility();

    expect(englishMode.value).toBe('show');
    expect(spanishMode.value).toBe('show');
  });

  test('a valid pair beside a broken one still applies', async () => {
    setCookie('fr:hidden,es:spoiler');
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().spanishMode.value).toBe('spoiler');
  });
});

describe('a signed-in reader', () => {
  test('the account preference wins over whatever cookie this browser has', async () => {
    // This is the entire reason it is stored on the account: a choice made on a
    // laptop has to reach a phone whose cookie says something else.
    user.isLoggedIn = true;
    user.preferences = { translationVisibilityPreferences: { EN: 'hidden' } };
    setCookie('en:spoiler');
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().englishMode.value).toBe('hidden');
  });

  test('the cookie is rewritten to match, so the next SSR render agrees', async () => {
    user.isLoggedIn = true;
    user.preferences = { translationVisibilityPreferences: { EN: 'hidden' } };
    setCookie('en:spoiler');
    const useTranslationVisibility = await loadComposable();

    useTranslationVisibility();

    expect(cookieValue()).toBe('en:hidden');
  });

  test('a signed-in reader with nothing saved keeps this browser’s cookie', async () => {
    user.isLoggedIn = true;
    setCookie('en:spoiler');
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().englishMode.value).toBe('spoiler');
  });

  test('a change is persisted to the account', async () => {
    user.isLoggedIn = true;
    const useTranslationVisibility = await loadComposable();

    await useTranslationVisibility().setSpanishMode('hidden');

    expect(sdk.updateUserPreferences).toHaveBeenCalledWith({ translationVisibilityPreferences: { ES: 'hidden' } });
  });

  test('a failed persist still holds the preference for this browser', async () => {
    // The cookie was already written, so only cross-device sync is lost -- not
    // worth interrupting the reader over.
    user.isLoggedIn = true;
    sdk.updateUserPreferences.mockRejectedValue(new Error('offline'));
    const useTranslationVisibility = await loadComposable();
    const { setEnglishMode, englishMode } = useTranslationVisibility();

    await setEnglishMode('hidden');

    expect(englishMode.value).toBe('hidden');
    expect(cookieValue()).toBe('en:hidden');
    expect(handleApiError).toHaveBeenCalledWith('translation-visibility:persist-failed', expect.anything(), {
      toastKey: false,
    });
  });

  test('a signed-out reader is never asked to persist anything', async () => {
    const useTranslationVisibility = await loadComposable();

    await useTranslationVisibility().setEnglishMode('hidden');

    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
  });

  test('setting a mode it already has writes nothing at all', async () => {
    user.isLoggedIn = true;
    const useTranslationVisibility = await loadComposable();

    await useTranslationVisibility().setEnglishMode('show');

    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
    expect(cookieValue()).toBeNull();
  });
});

describe('includedLanguages, which becomes the API filter', () => {
  test('is absent when both languages are visible, keeping the default compact', async () => {
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().includedLanguages.value).toBeUndefined();
  });

  test('names the survivor when one language is hidden', async () => {
    const useTranslationVisibility = await loadComposable();
    const visibility = useTranslationVisibility();

    await visibility.setEnglishMode('hidden');

    expect(visibility.includedLanguages.value).toEqual(['ES']);
  });

  test('a spoilered language is still requested, because it is rendered blurred rather than dropped', async () => {
    const useTranslationVisibility = await loadComposable();
    const visibility = useTranslationVisibility();

    await visibility.setEnglishMode('spoiler');

    expect(visibility.includedLanguages.value).toBeUndefined();
  });

  test('is empty when the reader hid both', async () => {
    const useTranslationVisibility = await loadComposable();
    const visibility = useTranslationVisibility();

    await visibility.setEnglishMode('hidden');
    await visibility.setSpanishMode('hidden');

    expect(visibility.includedLanguages.value).toEqual([]);
  });

  test('always names a single global language choice rather than leaving it implicit', async () => {
    // A reader whose global choice is one language gets that one sent
    // explicitly, so the API does not fall back to "both".
    translationLanguages = ['EN'];
    const useTranslationVisibility = await loadComposable();

    expect(useTranslationVisibility().includedLanguages.value).toEqual(['EN']);
  });

  test('a hidden language is dropped from a single-language global choice too', async () => {
    translationLanguages = ['EN'];
    const useTranslationVisibility = await loadComposable();
    const visibility = useTranslationVisibility();

    await visibility.setEnglishMode('hidden');

    expect(visibility.includedLanguages.value).toEqual([]);
  });
});
