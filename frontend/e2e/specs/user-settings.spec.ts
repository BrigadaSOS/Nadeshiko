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
});
