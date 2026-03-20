import { test, expect } from '../auth';
import { HiddenMediaPage } from '../pages/HiddenMediaPage';

test.describe('Hidden Media', () => {
  test('displays hidden media page', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();
  });

  test('searches for media and displays results', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    await hiddenMedia.searchMedia('Poppy');
    await expect(hiddenMedia.searchResultByName('Poppy Hill').first()).toBeVisible();
  });

  test('hides and unhides media', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    // Search and hide
    await hiddenMedia.searchMedia('Poppy');
    const searchRow = hiddenMedia.searchResultByName('Poppy Hill');
    await expect(searchRow).toBeVisible();
    await hiddenMedia.hideMedia(searchRow);

    // Verify it appears in the hidden list
    await expect(hiddenMedia.hiddenItemByName('Poppy Hill')).toBeVisible({ timeout: 10_000 });

    // Unhide from the list
    const hiddenRow = hiddenMedia.hiddenItemByName('Poppy Hill');
    await hiddenMedia.unhideFromList(hiddenRow);

    // Verify it's removed from the hidden list
    await expect(hiddenMedia.hiddenItemByName('Poppy Hill')).not.toBeVisible({ timeout: 10_000 });
  });

  test('shows empty state when no media is hidden', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    await expect(hiddenMedia.hiddenItems).toHaveCount(0);
    await expect(authenticatedPage.getByText('0 hidden')).toBeVisible();
  });

  test('search with no results shows no search result rows', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    await hiddenMedia.searchInput.fill('xyznonexistentmedia12345');
    await authenticatedPage.waitForTimeout(500);
    await expect(hiddenMedia.searchResults).toHaveCount(0);
  });
});
