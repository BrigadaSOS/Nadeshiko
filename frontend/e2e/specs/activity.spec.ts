import { test, expect } from '../auth';
import { ActivityPage } from '../pages/ActivityPage';

test.describe('Activity', () => {
  test('displays activity overview with stats', async ({ authenticatedPage }) => {
    const activity = new ActivityPage(authenticatedPage);
    await activity.goto();
    await activity.expectLoaded();

    await expect(activity.overviewHeading).toBeVisible();
    await expect(activity.heatmapHeading).toBeVisible();
    await expect(activity.historyHeading).toBeVisible();
  });

  test('displays stat cards for all activity types', async ({ authenticatedPage }) => {
    const activity = new ActivityPage(authenticatedPage);
    await activity.goto();
    await activity.expectLoaded();

    await expect(activity.searchesCount).toBeVisible();
    await expect(activity.playsCount).toBeVisible();
    await expect(activity.exportsCount).toBeVisible();
    await expect(activity.sharesCount).toBeVisible();
  });

  test('audio play action appears in activity history', async ({ authenticatedPage }) => {
    // Navigate to search and find results
    await authenticatedPage.goto('/search');
    const searchInput = authenticatedPage.getByTestId('search-input');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('お鍋');
    await searchInput.press('Enter');
    await authenticatedPage.waitForLoadState('networkidle');

    // Click the audio play button on the first result
    const playButton = authenticatedPage.getByTestId('audio-play-button').first();
    await expect(playButton).toBeVisible({ timeout: 10_000 });
    await playButton.click();
    await authenticatedPage.waitForTimeout(1000);

    // Check activity history shows an Audio Play entry
    const activity = new ActivityPage(authenticatedPage);
    await activity.goto();
    await activity.expectLoaded();

    await expect(activity.activityRowByText('Audio Play').first()).toBeVisible({ timeout: 10_000 });
  });

  test('share action appears in activity history', async ({ authenticatedPage }) => {
    // Grant clipboard permissions
    await authenticatedPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Navigate to search and find results
    await authenticatedPage.goto('/search');
    const searchInput = authenticatedPage.getByTestId('search-input');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('お鍋');
    await searchInput.press('Enter');
    await authenticatedPage.waitForLoadState('networkidle');

    // Click the share button on the first result
    const shareButton = authenticatedPage.getByTestId('share-button').first();
    await expect(shareButton).toBeVisible({ timeout: 10_000 });
    await shareButton.click();
    await authenticatedPage.waitForTimeout(1000);

    // Check activity history shows a Share entry
    const activity = new ActivityPage(authenticatedPage);
    await activity.goto();
    await activity.expectLoaded();

    await expect(activity.activityRowByText('Share').first()).toBeVisible({ timeout: 10_000 });
  });
});
