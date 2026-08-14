import type { Page } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../auth';
import { SettingsPage } from '../pages/SettingsPage';

test.describe('User Settings', () => {
  test('displays correct username and email after login', async ({ authenticatedPage }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    await expect(settings.username).toHaveText('e2e-user');
    await expect(settings.email).toHaveText('e2e-user@nadeshiko.co');
  });

  test('redirects to home when not logged in', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/user/settings');
    await expect(page).toHaveURL(/\/[a-z]{2}\/?$/, { timeout: 10_000 });
  });

  test.describe('Default search category', () => {
    test.describe.configure({ mode: 'serial' });

    const resetDefaultCategory = (page: Page) =>
      page.request.patch('/v1/user/preferences', { data: { defaultSearchCategory: 'ALL' } });

    test('saves the category picked in settings', async ({ authenticatedPage }) => {
      const settings = new SettingsPage(authenticatedPage);

      try {
        await settings.goto();
        await settings.expectLoaded();
        await settings.defaultSearchCategory.selectOption('ANIME');
        await expect(authenticatedPage.getByText('Preference saved')).toBeVisible({ timeout: 10_000 });

        const stored = await (await authenticatedPage.request.get('/v1/user/preferences')).json();
        expect(stored.defaultSearchCategory).toBe('ANIME');
      } finally {
        await resetDefaultCategory(authenticatedPage);
      }
    });

    /**
     * Signs in fresh rather than reusing the shared authenticated page: SSR caches
     * the session *and* its preferences for 30s per session cookie, so a render
     * that follows a preference change on the same cookie can still be serving the
     * previous value. A new session has nothing cached under it.
     */
    test('opens searches on the stored category', async ({ page }) => {
      await loginAsE2EUser(page);

      try {
        await page.request.patch('/v1/user/preferences', { data: { defaultSearchCategory: 'ANIME' } });

        // The URL names no category, so the preference is what selects the tab.
        await page.goto('/search/学校');
        await expect(page.getByTestId('search-category-tab-anime')).toHaveAttribute('aria-current', 'true', {
          timeout: 15_000,
        });

        // All stays reachable: clearing the parameter would only mean "use the
        // default", so that tab has to spell itself out in the URL.
        await page.getByTestId('search-category-tab-all').click();
        await expect(page).toHaveURL(/[?&]category=all/, { timeout: 10_000 });
        await expect(page.getByTestId('search-category-tab-all')).toHaveAttribute('aria-current', 'true');
      } finally {
        await resetDefaultCategory(page);
      }
    });
  });

  test('persists the explicit language preference across server navigations', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');

    const langSelector = authenticatedPage.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('日本語').click();

    await expect(authenticatedPage).toHaveURL(/\/ja$/, { timeout: 10_000 });

    await authenticatedPage.goto('/');
    await expect(authenticatedPage).toHaveURL(/\/ja$/, { timeout: 10_000 });
  });
});
