import { test, expect } from '../auth';
import { HeaderPage } from '../pages/HeaderPage';

test.describe('Header Navigation', () => {
  test('shows auth links in profile dropdown when logged in', async ({ authenticatedPage }) => {
    const header = new HeaderPage(authenticatedPage);
    await authenticatedPage.goto('/');

    await header.openProfileDropdown();
    await header.expectAuthLinks();
  });

  test('shows login button in profile dropdown when not logged in', async ({ page }) => {
    const header = new HeaderPage(page);
    await page.goto('/');

    await header.openProfileDropdown();
    await header.expectGuestLinks();
  });

  test('navigates to settings from profile dropdown', async ({ authenticatedPage }) => {
    const header = new HeaderPage(authenticatedPage);
    await authenticatedPage.goto('/');

    await header.openProfileDropdown();
    await header.settingsLink.click();

    await expect(authenticatedPage).toHaveURL('/user/settings', { timeout: 10_000 });
  });

  test('navigates to collections from profile dropdown', async ({ authenticatedPage }) => {
    const header = new HeaderPage(authenticatedPage);
    await authenticatedPage.goto('/');

    await header.openProfileDropdown();
    await header.collectionsLink.click();

    await expect(authenticatedPage).toHaveURL('/user/collections', { timeout: 10_000 });
  });

  test('navigates to activity from profile dropdown', async ({ authenticatedPage }) => {
    const header = new HeaderPage(authenticatedPage);
    await authenticatedPage.goto('/');

    await header.openProfileDropdown();
    await header.activityLink.click();

    await expect(authenticatedPage).toHaveURL('/user/activity', { timeout: 10_000 });
  });
});
