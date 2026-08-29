// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The eye menu: how much of each translation a reader wants to see.
 *
 * Three settings behind one control, and the one thing that must not slip is
 * which is which -- picking "hidden" for Spanish and having English disappear is
 * the kind of fault a reader works around rather than reports.
 *
 * A language the account does not read is left out of the menu entirely, because
 * a control for a translation that never renders is a setting with no effect.
 *
 * The change is also ANNOUNCED into a live region: these are icon buttons inside
 * a menu, so a screen reader gets no feedback from the click itself, and the
 * announcement is read AFTER the write so it states what is true rather than
 * what was asked for.
 */
const englishMode = ref('show');
const spanishMode = ref('show');
const furiganaMode = ref('show');
const setEnglishMode = vi.fn(async (m: string) => {
  englishMode.value = m;
});
const setSpanishMode = vi.fn(async (m: string) => {
  spanishMode.value = m;
});
const setFuriganaMode = vi.fn((m: string) => {
  furiganaMode.value = m;
});
const languages = ref<string[]>(['EN', 'ES']);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useTranslationVisibility', () => ({ englishMode, spanishMode, setEnglishMode, setSpanishMode }));
vi.stubGlobal('useTranslationLanguages', () => ({ languages, dictionaryGlossLanguages: ref(['en']) }));
vi.stubGlobal('useHiraganaVisibility', () => ({ furiganaMode, setFuriganaMode }));

import TranslationVisibilityPreferences from './TranslationVisibilityPreferences.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(TranslationVisibilityPreferences, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchDropdownContainer: { template: '<div><slot :toggle="() => {}" /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const option = (w: ReturnType<typeof render>, group: string, mode: string) =>
  w.find(`[data-testid="visibility-${group}-option-${mode}"]`);
const liveRegion = (w: ReturnType<typeof render>) => w.find('[aria-live="polite"]').text();

beforeEach(() => {
  vi.clearAllMocks();
  englishMode.value = 'show';
  spanishMode.value = 'show';
  furiganaMode.value = 'show';
  languages.value = ['EN', 'ES'];
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which settings are offered', () => {
  test('one per language the account reads, plus furigana', () => {
    const wrapper = render();

    expect(option(wrapper, 'en', 'show').exists()).toBe(true);
    expect(option(wrapper, 'es', 'show').exists()).toBe(true);
    expect(option(wrapper, 'furigana', 'show').exists()).toBe(true);
  });

  test('a language the account does not read is left out', () => {
    // A control for a translation that never renders is a setting with no
    // effect, and one more thing to read past.
    languages.value = ['EN'];
    const wrapper = render();

    expect(option(wrapper, 'es', 'show').exists()).toBe(false);
    expect(option(wrapper, 'en', 'show').exists()).toBe(true);
  });

  test('furigana is offered whatever the translation languages are', () => {
    // It is about the Japanese, not about a translation.
    languages.value = [];
    const wrapper = render();

    expect(option(wrapper, 'furigana', 'show').exists()).toBe(true);
  });

  test('every setting offers all three modes', () => {
    const wrapper = render();

    for (const mode of ['show', 'spoiler', 'hidden']) {
      expect(option(wrapper, 'en', mode).exists()).toBe(true);
    }
  });
});

describe('picking a mode', () => {
  test('English goes to the English setting and nothing else', async () => {
    const wrapper = render();

    await option(wrapper, 'en', 'hidden').trigger('click');
    await flushPromises();

    expect(setEnglishMode).toHaveBeenCalledWith('hidden');
    expect(setSpanishMode).not.toHaveBeenCalled();
    expect(setFuriganaMode).not.toHaveBeenCalled();
  });

  test('Spanish goes to the Spanish one', async () => {
    const wrapper = render();

    await option(wrapper, 'es', 'spoiler').trigger('click');
    await flushPromises();

    expect(setSpanishMode).toHaveBeenCalledWith('spoiler');
    expect(setEnglishMode).not.toHaveBeenCalled();
  });

  test('and furigana to furigana', async () => {
    const wrapper = render();

    await option(wrapper, 'furigana', 'hidden').trigger('click');
    await flushPromises();

    expect(setFuriganaMode).toHaveBeenCalledWith('hidden');
    expect(setEnglishMode).not.toHaveBeenCalled();
  });
});

describe('announcing the change', () => {
  test('says what is now true, per subject and mode', async () => {
    // Icon buttons inside a menu give a screen reader nothing on click.
    const wrapper = render();

    await option(wrapper, 'en', 'hidden').trigger('click');
    await flushPromises();

    expect(liveRegion(wrapper)).toBe('searchpage.main.translationPreferences.englishHidden');
  });

  test('names the SUBJECT that changed, not just the mode', async () => {
    const wrapper = render();

    await option(wrapper, 'es', 'spoiler').trigger('click');
    await flushPromises();

    expect(liveRegion(wrapper)).toBe('searchpage.main.translationPreferences.spanishSpoiler');
  });

  test('reads the state AFTER the write, so it cannot claim a change that failed', async () => {
    // The setter refuses; the announcement has to say what is true.
    setEnglishMode.mockImplementation(async () => {});
    const wrapper = render();

    await option(wrapper, 'en', 'hidden').trigger('click');
    await flushPromises();

    expect(liveRegion(wrapper)).toBe('searchpage.main.translationPreferences.englishShown');
  });
});
