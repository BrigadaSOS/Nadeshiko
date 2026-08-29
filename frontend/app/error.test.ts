// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The error page, which is the one page that must not make things worse.
 *
 * It carries `noindex` unconditionally: an error page in the index is a search
 * result that leads nowhere, and these are served under whatever URL failed --
 * so every one of them is a distinct URL a crawler would otherwise keep.
 *
 * And the way back is `clearError` with a redirect, not a plain link: without
 * clearing, Nuxt keeps the error state and the reader lands on the home route
 * still looking at the error page.
 */
const capturedHead: unknown[] = [];
const clearError = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useHead', (v: unknown) => capturedHead.push(v));
vi.stubGlobal('clearError', clearError);

import ErrorPage from './error.vue';

const mounted: { unmount: () => void }[] = [];

function render(statusCode: number) {
  capturedHead.length = 0;
  const wrapper = mount(ErrorPage, {
    props: { error: { statusCode, message: 'boom' } } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, UiBaseIcon: true, NuxtImg: true },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The head object this page produced, with the factory resolved. */
function head() {
  const entry = capturedHead[0];
  return typeof entry === 'function' ? (entry as () => Record<string, unknown>)() : (entry as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('what the page says', () => {
  test('a 404 is "not found", not "something went wrong"', async () => {
    // The two need different words: one is a wrong address, the other is us.
    const wrapper = render(404);

    expect(wrapper.text()).toContain('errorPage.pageNotFound');
    expect(wrapper.text()).not.toContain('errorPage.somethingWentWrong');
  });

  test('and anything else is our fault, not theirs', async () => {
    const wrapper = render(500);

    expect(wrapper.text()).toContain('errorPage.somethingWentWrong');
  });

  test('the title matches, and is branded', () => {
    render(404);

    expect(String(head().title)).toBe('errorPage.pageNotFound | Nadeshiko');
  });
});

describe('what the page tells crawlers', () => {
  test.each([
    ['a 404', 404],
    ['a 500', 500],
  ])('%s is noindex', (_name, status) => {
    // These are served under whatever URL failed, so each one is a distinct URL
    // a crawler would otherwise keep, leading nowhere.
    render(status);

    const meta = head().meta as { name: string; content: string }[];
    expect(meta.find((m) => m.name === 'robots')?.content).toBe('noindex');
  });
});

describe('the way back', () => {
  test('CLEARS the error as it redirects', async () => {
    // An `<a>` with a real href so it works without JS, but the click is
    // intercepted: a plain navigation leaves Nuxt's error state in place and the
    // reader lands on the home route still looking at this page.
    const wrapper = render(404);
    const link = wrapper.get('a[href="/en/"]');

    await link.trigger('click');

    expect(clearError).toHaveBeenCalledWith({ redirect: '/en/' });
  });

  test('but still carries a real href, so it works without JS', async () => {
    expect(render(404).get('a[href="/en/"]').attributes('href')).toBe('/en/');
  });

  test('goes to the LOCALISED home, not the bare root', () => {
    // A Spanish reader dropped on `/` loses their language.
    const wrapper = render(404);

    expect(wrapper.html()).toContain('/en/');
  });
});
