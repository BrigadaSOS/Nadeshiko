// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

/**
 * The settings shell: the tab strip every `/user/**` page sits inside.
 *
 * Two decisions live here. WHICH TABS a reader is offered -- the admin ones are
 * appended only for an admin, and offering them otherwise is a row of links to
 * pages that will bounce them. And WHICH TAB is lit, which is derived by
 * stripping the locale prefix rather than by rebuilding every candidate path in
 * three languages: a Spanish reader on `/es/user/sync` must light the same tab
 * an English one does on `/en/user/sync`.
 *
 * `/user` itself is lit as Settings, because that is where it lands.
 */
const isAdmin = ref(false);
const route = reactive({ path: '/en/user/sync', params: {}, query: {}, fullPath: '/en/user/sync' });

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k, locale: ref('en') }) }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('defineNuxtRouteMiddleware', (fn: unknown) => fn);
vi.stubGlobal('navigateTo', vi.fn());
vi.stubGlobal('useDragScroll', () => ({ onMouseDown: vi.fn(), scrollerRef: ref(null) }));
vi.stubGlobal('userStore', () => ({
  get isAdmin() {
    return isAdmin.value;
  },
  isLoggedIn: true,
  user: { id: 'u1' },
}));

import UserShell from './user.vue';

const mounted: { unmount: () => void }[] = [];

function render(path = '/en/user/sync') {
  route.path = path;
  route.fullPath = path;
  const wrapper = mount(UserShell, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        // `class="active"` is how the shell marks the current tab; the stub has
        // to let the bound class through for that to be readable.
        NuxtLink: { props: ['to'], inheritAttrs: true, template: '<a :href="to"><slot /></a>' },
        NuxtPage: true,
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/**
 * Every tab link's target, DEDUPLICATED: the strip is rendered twice, once for
 * desktop and once for mobile, so a raw list double-counts every tab.
 */
const tabs = (w: ReturnType<typeof render>) => [...new Set(w.findAll('a').map((a) => a.attributes('href') ?? ''))];
/** The tab the shell marks current, which it does with an `active` class. */
const currentTab = (w: ReturnType<typeof render>) => {
  const marked = [
    ...new Set(
      w
        .findAll('a')
        .filter((a) => a.classes().includes('active'))
        .map((a) => a.attributes('href') ?? ''),
    ),
  ];
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0];
};

beforeEach(() => {
  isAdmin.value = false;
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which tabs are offered', () => {
  test('the ordinary ones, for any signed-in reader', () => {
    const wrapper = render();

    for (const path of ['/user/settings', '/user/sync', '/user/collections', '/user/activity', '/user/media']) {
      expect(tabs(wrapper)).toContain(`/en${path}`);
    }
  });

  test('and the developer tab, which needs no special role', () => {
    expect(tabs(render())).toContain('/en/user/developer');
  });

  test('but NOT the admin ones', () => {
    // A row of links to pages that would bounce them.
    const wrapper = render();

    for (const path of ['/user/admin/users', '/user/admin/reports', '/user/admin/announcement']) {
      expect(tabs(wrapper)).not.toContain(`/en${path}`);
    }
  });

  test('an admin gets them, after the ordinary ones', () => {
    isAdmin.value = true;
    const wrapper = render();

    const all = tabs(wrapper);
    expect(all).toContain('/en/user/admin/users');
    expect(all.indexOf('/en/user/admin/users')).toBeGreaterThan(all.indexOf('/en/user/settings'));
  });

  test('the desktop and mobile strips offer the SAME tabs', () => {
    // They are built from different lists -- the sidebar iterates each group, the
    // mobile bar iterates the combined one -- so they can drift apart, and a tab
    // reachable on one layout and not the other is invisible to whoever is on the
    // wrong screen. Every tab should therefore appear exactly twice.
    isAdmin.value = true;
    const wrapper = render();

    const counts = new Map<string, number>();
    for (const href of wrapper.findAll('a').map((a) => a.attributes('href') ?? '')) {
      counts.set(href, (counts.get(href) ?? 0) + 1);
    }
    for (const [href, n] of counts) expect(`${href}:${n}`).toBe(`${href}:2`);
  });

  test('starring and hiding share ONE tab, not two', () => {
    // Both decide which titles the media filter shows and in what order, so
    // they are one setting with two signs rather than two places to look.
    const wrapper = render();

    expect(tabs(wrapper).filter((t) => t.includes('/user/media'))).toHaveLength(1);
  });
});

describe('which tab is lit', () => {
  test('the one the child route is on', () => {
    expect(currentTab(render('/en/user/sync'))).toBe('/en/user/sync');
  });

  test('whatever language the reader is in', () => {
    // Derived by stripping the locale prefix rather than rebuilding every
    // candidate path in three languages.
    expect(currentTab(render('/es/user/sync'))).toBe('/en/user/sync');
    expect(currentTab(render('/ja/user/sync'))).toBe('/en/user/sync');
  });

  test('a trailing slash does not lose it', () => {
    expect(currentTab(render('/en/user/sync/'))).toBe('/en/user/sync');
  });

  test('`/user` itself lights Settings, because that is where it lands', () => {
    expect(currentTab(render('/en/user'))).toBe('/en/user/settings');
  });

  test('a deeper admin path lights its own tab', () => {
    isAdmin.value = true;

    expect(currentTab(render('/en/user/admin/reports'))).toBe('/en/user/admin/reports');
  });
});
