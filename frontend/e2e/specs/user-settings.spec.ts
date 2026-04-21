import { test, expect } from '../auth';
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
    await page.goto('/user/settings');
    await expect(page).toHaveURL('/', { timeout: 10_000 });
  });

  test('uses the explicit language preference for authenticated user pages', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');

    const langSelector = authenticatedPage.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('日本語').click();

    await expect(authenticatedPage).toHaveURL(/\/ja$/, { timeout: 10_000 });

    await authenticatedPage.goto('/search/彼女');
    await expect(authenticatedPage).toHaveURL(/\/search\/彼女$/, { timeout: 10_000 });

    await authenticatedPage.goto('/user/settings');
    await expect(authenticatedPage).toHaveURL(/\/ja\/user\/settings$/, { timeout: 10_000 });
  });
});
