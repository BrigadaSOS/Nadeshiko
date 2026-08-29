// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The language switcher.
 *
 * Two things it must get right, and both have bitten.
 *
 * The hrefs come from `useLocaleSwitchPath`, NOT the i18n module's
 * `useSwitchLocalePath`: on a search page the module builds them one
 * percent-encoding layer deeper than the URL that was requested, so every switch
 * produced a longer URL than the last and a single search bred an unbounded
 * family of them.
 *
 * And the choice is REMEMBERED before it is applied. `setLocale` navigates, so a
 * preference written afterwards may never be written at all -- and the reader
 * gets their browser's language again on the next visit, having just told us
 * otherwise.
 */
const setLocale = vi.fn();
const setPreferredLocale = vi.fn();
const switchLocalePath = vi.fn((code: string) => `/${code}/search/cat`);
const locale = ref('en');
const locales = ref([
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'ja', name: '日本語' },
]);

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale, locales, setLocale, t: (k: string) => k }) }));
vi.mock('~/composables/useLocalePreference', () => ({ useLocalePreference: () => ({ setPreferredLocale }) }));
vi.stubGlobal('useLocaleSwitchPath', () => switchLocalePath);

import LanguageSelector from './LanguageSelector.vue';

const mounted: { unmount: () => void }[] = [];

function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(LanguageSelector, {
    props,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchDropdownContainer: {
          props: ['dropdownContainerClass'],
          template: '<div :data-container-class="dropdownContainerClass"><slot /><slot name="content" /></div>',
        },
        SearchDropdownContent: { template: '<div><slot /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        // The href lives on the WRAPPING NuxtLink, not on the item, and the
        // click handler is on the link too -- so both have to be real here.
        NuxtLink: {
          props: ['to'],
          template: '<a class="lang-link" :href="to" @click="$emit(\'click\')"><slot /></a>',
        },
        SearchDropdownItem: { props: ['text'], template: '<span class="lang" :data-text="text">{{ text }}</span>' },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const options = (w: ReturnType<typeof render>) => w.findAll('.lang');
/** The clickable link wrapping one language's item. */
const optionFor = (w: ReturnType<typeof render>, name: string) => {
  const found = w
    .findAll('.lang-link')
    .find((n) => n.find('.lang').exists() && n.find('.lang').attributes('data-text') === name);
  if (!found) throw new Error(`no option for ${name}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  locale.value = 'en';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the options', () => {
  test('lists every configured language by its own name', async () => {
    // Named in the language itself, so a reader who cannot read the current one
    // can still find theirs.
    const wrapper = render();

    expect(options(wrapper).map((n) => n.attributes('data-text'))).toEqual(['English', 'Español', '日本語']);
  });
});

describe('switching', () => {
  test('remembers the choice BEFORE applying it', async () => {
    // `setLocale` navigates; a preference written after it may never be written,
    // and the reader gets their browser's language back next visit.
    const wrapper = render();

    await optionFor(wrapper, 'Español').trigger('click');
    await flushPromises();

    expect(setPreferredLocale).toHaveBeenCalledWith('es');
    expect(setLocale).toHaveBeenCalledWith('es');
    expect(setPreferredLocale.mock.invocationCallOrder[0]).toBeLessThan(setLocale.mock.invocationCallOrder[0]!);
  });

  test('applies the language that was chosen', async () => {
    const wrapper = render();

    await optionFor(wrapper, '日本語').trigger('click');
    await flushPromises();

    expect(setLocale).toHaveBeenCalledWith('ja');
  });
});

describe('the links behind the options', () => {
  test('come from the local switch-path helper, not the i18n module’s', async () => {
    // The module's version encodes one layer deeper than the requested URL, so
    // each switch on a search page produced a longer URL than the last.
    const wrapper = render();

    expect(switchLocalePath).toHaveBeenCalled();
    expect(optionFor(wrapper, 'Español').attributes('href')).toBe('/es/search/cat');
  });

  test('one per language, so every option is a real link', async () => {
    const wrapper = render();

    for (const link of wrapper.findAll('.lang-link')) {
      expect(link.attributes('href')).toBeTruthy();
    }
  });
});

describe('where the menu opens', () => {
  test('downwards by default', () => {
    const wrapper = render();

    expect(wrapper.get('[data-container-class]').attributes('data-container-class')).toContain('top-full');
  });

  test('and upwards when asked, for a control at the bottom of the page', () => {
    // The footer's copy would otherwise open off the bottom of the viewport.
    const wrapper = render({ dropUp: true });

    expect(wrapper.get('[data-container-class]').attributes('data-container-class')).toContain('bottom-full');
  });
});
