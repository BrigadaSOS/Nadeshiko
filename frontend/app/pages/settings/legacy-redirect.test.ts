// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The legacy `/settings/*` redirect.
 *
 * These paths were the real page tree before the account pages moved under
 * `/user/*`, so bookmarks and old links still point at them. Without this they
 * fall through to the site-wide markdown catch-all and 404 -- which is the
 * failure this exists to prevent, and it is invisible from the new tree.
 *
 * `settigns` is a typo that was live long enough to be linked, and forwarding it
 * is cheaper than working out who still has it saved.
 *
 * The redirect is a 301 and `replace`: these URLs are not coming back, and
 * leaving them in the history means Back bounces the reader forward again.
 */
const navigateTo = vi.fn((path: string, _options?: Record<string, unknown>) => path);
const preferredLocalePath = vi.fn((p: string) => `/en${p}`);
let middleware: ((to: { path: string }) => unknown) | null = null;

vi.mock('~/middleware/locale-preference', () => ({
  preferredLocalePath: (p: string) => preferredLocalePath(p),
}));
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('defineNuxtRouteMiddleware', (fn: (to: { path: string }) => unknown) => fn);
vi.stubGlobal('definePageMeta', (meta: { middleware?: (to: { path: string }) => unknown }) => {
  middleware = meta.middleware ?? null;
});
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));

import { splitLocalePrefix } from '~/utils/routes';
vi.stubGlobal('splitLocalePrefix', splitLocalePrefix);

import LegacySettingsRedirect from './[...slug].vue';

const mounted: { unmount: () => void }[] = [];

/** Mounts the page so its `definePageMeta` runs, then drives the middleware. */
function redirectFor(path: string) {
  navigateTo.mockClear();
  const wrapper = mount(LegacySettingsRedirect, { global: { mocks: { $t: (k: string) => k } } });
  mounted.push(wrapper);
  if (!middleware) throw new Error('the page registered no middleware');
  middleware({ path });
  return navigateTo.mock.calls[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('where each old path now goes', () => {
  test.each([
    ['/settings', '/en/user'],
    ['/settings/account', '/en/user/settings'],
    ['/settings/settings', '/en/user/settings'],
    ['/settings/dashboard', '/en/user/admin/users'],
    ['/settings/reports', '/en/user/admin/reports'],
    ['/settings/sync', '/en/user/sync'],
    ['/settings/collections', '/en/user/collections'],
  ])('%s becomes %s', (from, to) => {
    expect(redirectFor(from)?.[0]).toBe(to);
  });

  test('the `settigns` typo forwards too, because it was live long enough to be linked', () => {
    expect(redirectFor('/settings/settigns')?.[0]).toBe('/en/user/settings');
  });

  test('a nested reports path keeps its tail', () => {
    expect(redirectFor('/settings/reports/42')?.[0]).toBe('/en/user/admin/reports/42');
  });

  test('a trailing slash does not produce a doubled path', () => {
    expect(redirectFor('/settings/')?.[0]).toBe('/en/user');
  });

  test('a locale-prefixed old link is stripped before matching', () => {
    // Otherwise `/es/settings/account` falls through to the catch-all and 404s.
    expect(redirectFor('/es/settings/account')?.[0]).toBe('/en/user/settings');
  });
});

describe('how it redirects', () => {
  test('permanently, and replacing history', () => {
    // These URLs are not coming back, and leaving them in history means Back
    // bounces the reader straight forward again.
    expect(redirectFor('/settings/account')?.[1]).toEqual({ replace: true, redirectCode: 301 });
  });

  test('through the reader’s preferred locale, not a bare path', () => {
    redirectFor('/settings/account');

    expect(preferredLocalePath).toHaveBeenCalledWith('/user/settings');
  });
});
