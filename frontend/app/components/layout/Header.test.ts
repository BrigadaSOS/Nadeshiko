// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

/**
 * The site header and the mobile drawer inside it.
 *
 * Everything here turns on ONE question -- is anyone signed in -- and the two
 * ways of getting it wrong are not symmetric. Offering a signed-out reader links
 * to an account they do not have is a dead end; showing a signed-in reader the
 * sign-in prompt is merely confusing. Both are pinned.
 *
 * The drawer is the other half. It closes itself on a ROUTE CHANGE, which covers
 * every link inside it -- and leaves every control that does NOT navigate to
 * close it by hand. Each of those is its own small bug: the drawer sits open
 * behind the panel or modal it just raised.
 */
const isLoggedIn = ref(false);
const logout = vi.fn();
const openFeedback = vi.fn();
const showLoginModal = vi.fn();
const navigateTo = vi.fn();
const route = reactive({ fullPath: '/', path: '/', params: {}, query: {} });

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useLoginModal', () => ({
  openLoginModal: showLoginModal,
  closeLoginModal: vi.fn(),
  isLoginModalOpen: ref(false),
}));
vi.stubGlobal('useFeedbackWidget', () => ({ openFeedback, isFeedbackOpen: ref(false) }));
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('userStore', () => ({
  get isLoggedIn() {
    return isLoggedIn.value;
  },
  logout,
  user: { id: 'u1', name: 'Reader' },
  userName: 'Reader',
}));

import { useEnterSubmit } from '~/composables/useEnterSubmit';
vi.stubGlobal('useEnterSubmit', useEnterSubmit);

import Header from './Header.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(Header, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        // The drawer IS a BaseModal: stubbed as `true` it renders whatever its
        // `open` prop says, and every assertion about the drawer being shut
        // fails -- or worse, passes for the wrong reason.
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        LayoutLocaleSwitcher: true,
        CommonFeedbackWidget: true,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const has = (w: ReturnType<typeof render>, id: string) => w.find(`[data-testid="${id}"]`).exists();
const get = (w: ReturnType<typeof render>, id: string) => w.get(`[data-testid="${id}"]`);
const drawerOpen = (w: ReturnType<typeof render>) => w.find('[data-testid="nav-menu"]').exists();

async function openDrawer(w: ReturnType<typeof render>) {
  await get(w, 'hamburger-menu').trigger('click');
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
  isLoggedIn.value = false;
  route.fullPath = '/';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('what a signed-OUT reader is offered', () => {
  test('a way in', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-login')).toBe(true);
  });

  test('and none of the account pages, which would be dead ends', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    for (const id of ['nav-settings', 'nav-collections', 'nav-activity', 'nav-anki', 'nav-logout']) {
      expect(has(wrapper, id)).toBe(false);
    }
  });

  test('and not the hidden-media settings either, which live under the account', async () => {
    // `nav-media` is `/user/media` -- the reader's own hidden-titles list, not
    // the public catalogue.
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-media')).toBe(false);
  });
});

describe('what a signed-IN reader is offered', () => {
  beforeEach(() => {
    isLoggedIn.value = true;
  });

  test('their account pages', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    for (const id of ['nav-settings', 'nav-collections', 'nav-activity', 'nav-anki', 'nav-media']) {
      expect(has(wrapper, id)).toBe(true);
    }
  });

  test('a way out', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-logout')).toBe(true);
  });

  test('and not the sign-in prompt', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    expect(has(wrapper, 'nav-login')).toBe(false);
  });

  test('signing out closes the drawer as it goes', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'nav-logout').trigger('click');
    await nextTick();

    expect(logout).toHaveBeenCalled();
    expect(drawerOpen(wrapper)).toBe(false);
  });
});

describe('the drawer', () => {
  test('starts shut', () => {
    expect(drawerOpen(render())).toBe(false);
  });

  test('the hamburger opens it', async () => {
    const wrapper = render();

    await openDrawer(wrapper);

    expect(drawerOpen(wrapper)).toBe(true);
  });

  test('a navigation closes it, which covers every link inside', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    route.fullPath = '/en/media';
    await nextTick();

    expect(drawerOpen(wrapper)).toBe(false);
  });

  test('opening feedback closes it too, because a panel is not a navigation', async () => {
    // Left alone the drawer sits open behind the panel it just raised.
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'feedback-nav-link').trigger('click');
    await nextTick();

    expect(openFeedback).toHaveBeenCalled();
    expect(drawerOpen(wrapper)).toBe(false);
  });

  test('and so does the sign-in prompt, which is a modal', async () => {
    const wrapper = render();
    await openDrawer(wrapper);

    await get(wrapper, 'nav-login').trigger('click');
    await nextTick();

    expect(showLoginModal).toHaveBeenCalledWith('header');
    expect(drawerOpen(wrapper)).toBe(false);
  });
});

describe('searching from the drawer', () => {
  async function searchFor(wrapper: ReturnType<typeof render>, term: string) {
    await openDrawer(wrapper);
    const box = wrapper.find('[data-testid="nav-menu"] input');
    if (!box.exists()) throw new Error('no drawer search box');
    await box.setValue(term);
    await box.trigger('keydown', { key: 'Enter' });
    await nextTick();
  }

  test('goes to the search page for what was typed', async () => {
    const wrapper = render();

    await searchFor(wrapper, '猫');

    expect(navigateTo).toHaveBeenCalledWith(`/en/search/${encodeURIComponent('猫')}`);
  });

  test('trims it first', async () => {
    const wrapper = render();

    await searchFor(wrapper, '  猫  ');

    expect(navigateTo).toHaveBeenCalledWith(`/en/search/${encodeURIComponent('猫')}`);
  });

  test('an empty box goes nowhere', async () => {
    const wrapper = render();

    await searchFor(wrapper, '   ');

    expect(navigateTo).not.toHaveBeenCalled();
  });

  test('and closes the drawer on its way', async () => {
    const wrapper = render();

    await searchFor(wrapper, '猫');

    expect(drawerOpen(wrapper)).toBe(false);
  });
});
