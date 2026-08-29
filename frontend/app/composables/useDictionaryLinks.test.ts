import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

import { DICT_LINKS_COOKIE } from '#shared/utils/preferenceCookies';

/**
 * Which external dictionaries the word card links out to.
 *
 * Stored in a cookie because it is read during SSR and is therefore a cache
 * key, and that forces the distinction this file mostly exists to pin: an
 * EMPTY cookie ("every dictionary off") has to be tellable from an ABSENT one
 * ("never chose"). Collapse the two and a reader who deliberately turned
 * everything off gets the defaults back on their next page load.
 *
 * shirabe.org is `required`: the card itself is built from it, so "turn it off"
 * would mean "hide the link to the thing you are already reading". The UI does
 * not offer that toggle, so a write reaching it is a stale cookie or a caller
 * that does not know -- and neither should be able to switch it off.
 */
const cookies = new Map<string, ReturnType<typeof ref<string | null>>>();

/**
 * `useState`, scoped to ONE test rather than to the run.
 *
 * The suite-wide stub keeps one ref per key for the whole file, and `useState`'s
 * initializer only runs for whichever call claims the key first -- so the second
 * test onwards would read the first test's reader preference instead of parsing
 * its own cookie, and every assertion here would be about the first fixture.
 * A fresh map per test is what a fresh request is.
 */
let nuxtState = new Map<string, ReturnType<typeof ref>>();

vi.stubGlobal('useState', (key: string, init?: () => unknown) => {
  if (!nuxtState.has(key)) nuxtState.set(key, ref(init ? init() : undefined));
  return nuxtState.get(key)!;
});
vi.stubGlobal('useCookie', (name: string) => {
  if (!cookies.has(name)) cookies.set(name, ref<string | null>(null));
  return cookies.get(name)!;
});

/** Re-imports the composable so each test gets its own `useState` bucket. */
async function loadComposable() {
  vi.resetModules();
  const { useCookiePreference, PREFERENCE_COOKIE_OPTIONS } = await import('./useCookiePreference');
  vi.stubGlobal('useCookiePreference', useCookiePreference);
  vi.stubGlobal('PREFERENCE_COOKIE_OPTIONS', PREFERENCE_COOKIE_OPTIONS);
  const mod = await import('./useDictionaryLinks');
  return { use: mod.useDictionaryLinks, presets: mod.DICTIONARY_PRESETS };
}

/** Starts a reader off with this exact cookie -- `null` meaning they have none. */
function setCookie(value: string | null) {
  cookies.set(DICT_LINKS_COOKIE, ref(value));
}

const cookieValue = () => cookies.get(DICT_LINKS_COOKIE)?.value ?? null;

beforeEach(() => {
  cookies.clear();
  nuxtState = new Map();
});

describe('a reader who has never chosen', () => {
  test('gets the defaults', async () => {
    setCookie(null);
    const { use, presets } = await loadComposable();

    const expected = presets.filter((preset) => preset.defaultEnabled).map((preset) => preset.id);
    expect(use().enabledDictionaries.value).toEqual(expected);
  });

  test('and the defaults are not "everything"', async () => {
    // A row of six links is a row nobody reads. Turning one off by default only
    // affects readers who never set the preference at all.
    setCookie(null);
    const { use, presets } = await loadComposable();

    expect(use().enabledDictionaries.value.length).toBeLessThan(presets.length);
  });
});

describe('a reader who turned everything off', () => {
  test('keeps them off, rather than being handed the defaults back', async () => {
    // The whole reason the empty cookie is written as `''` and not cleared.
    setCookie('');
    const { use } = await loadComposable();

    expect(use().enabledDictionaries.value).toEqual([]);
  });

  test('which is a different state from never having chosen', async () => {
    setCookie('');
    const empty = (await loadComposable()).use().enabledDictionaries.value;
    cookies.clear();
    nuxtState = new Map();
    setCookie(null);
    const unset = (await loadComposable()).use().enabledDictionaries.value;

    expect(empty).not.toEqual(unset);
  });
});

describe('reading a stored choice', () => {
  test('takes the dictionaries named in the cookie', async () => {
    setCookie('jisho,jpdb');
    const { use } = await loadComposable();

    expect(use().enabledDictionaries.value).toEqual(['jisho', 'jpdb']);
  });

  test('tolerates the whitespace a hand-edited cookie carries', async () => {
    setCookie(' jisho , jpdb ');
    const { use } = await loadComposable();

    expect(use().enabledDictionaries.value).toEqual(['jisho', 'jpdb']);
  });

  test('drops a name it does not recognise instead of trusting it', async () => {
    // A preset removed since the cookie was written, or a value someone typed.
    // Carried through, it reaches the link row as an entry with no url.
    setCookie('jisho,goo,jpdb');
    const { use } = await loadComposable();

    expect(use().enabledDictionaries.value).toEqual(['jisho', 'jpdb']);
  });

  test('a cookie of nothing but junk leaves the row empty, not broken', async () => {
    setCookie('goo,alc');
    const { use } = await loadComposable();

    expect(use().enabledDictionaries.value).toEqual([]);
  });
});

describe('changing the choice', () => {
  test('turning one on adds it', async () => {
    setCookie('');
    const { use } = await loadComposable();
    const links = use();

    links.setDictionaryEnabled('jisho', true);

    expect(links.enabledDictionaries.value).toContain('jisho');
  });

  test('turning one off removes only that one', async () => {
    setCookie('jisho,jpdb');
    const { use } = await loadComposable();
    const links = use();

    links.setDictionaryEnabled('jisho', false);

    expect(links.enabledDictionaries.value).toEqual(['jpdb']);
  });

  test('writes the choice back in PRESET order, not click order', async () => {
    // The order is what readers see, in settings and in the link row; storing
    // click order would reshuffle the row every time they changed anything.
    setCookie('');
    const { use, presets } = await loadComposable();
    const links = use();

    links.setDictionaryEnabled('weblio', true);
    links.setDictionaryEnabled('jisho', true);

    const order = presets.map((preset) => preset.id);
    expect(order.indexOf(links.enabledDictionaries.value[0]!)).toBeLessThan(
      order.indexOf(links.enabledDictionaries.value[1]!),
    );
  });

  test('persists it to the cookie, which the server reads too', async () => {
    setCookie('');
    const { use } = await loadComposable();

    use().setDictionaryEnabled('jisho', true);

    expect(cookieValue()).toBe('jisho');
  });

  test('writes an EMPTY string when the last one is turned off', async () => {
    // Not a cleared cookie: that would read as "never chose" and hand the
    // defaults back on the next page load.
    setCookie('jisho');
    const { use } = await loadComposable();

    use().setDictionaryEnabled('jisho', false);

    expect(cookieValue()).toBe('');
  });
});

describe('the dictionary the card is built from', () => {
  test('is always on, whatever the cookie says', async () => {
    // "Turn it off" would mean "hide the link to the thing you are already
    // reading".
    setCookie('');
    const { use } = await loadComposable();

    expect(use().isDictionaryEnabled('shirabe')).toBe(true);
  });

  test('cannot be turned off by a stale cookie or a caller that does not know', async () => {
    // Asserted on what gets STORED, not on `isDictionaryEnabled`: that answers
    // true for a required preset whatever the cookie holds, so it would report
    // success over a write that had just removed it.
    setCookie('shirabe,jisho');
    const { use } = await loadComposable();
    const links = use();

    links.setDictionaryEnabled('shirabe', false);

    expect(links.enabledDictionaries.value).toContain('shirabe');
    expect(cookieValue()).toContain('shirabe');
  });

  test('and the refused write changes nothing else either', async () => {
    // Ignored rather than thrown, but it must not quietly rewrite the rest of
    // the row on its way out.
    setCookie('jisho,jpdb');
    const { use } = await loadComposable();
    const links = use();

    links.setDictionaryEnabled('shirabe', false);

    expect(links.enabledDictionaries.value).toEqual(['jisho', 'jpdb']);
  });

  test('leads the row, being the odd one out at any other position', async () => {
    const { presets } = await loadComposable();

    expect(presets[0]!.id).toBe('shirabe');
    expect(presets[0]!.required).toBe(true);
  });
});

describe('asking whether one is enabled', () => {
  test('says yes for a chosen dictionary', async () => {
    setCookie('jisho');
    const { use } = await loadComposable();

    expect(use().isDictionaryEnabled('jisho')).toBe(true);
  });

  test('and no for one the reader left off', async () => {
    setCookie('jisho');
    const { use } = await loadComposable();

    expect(use().isDictionaryEnabled('jpdb')).toBe(false);
  });
});
