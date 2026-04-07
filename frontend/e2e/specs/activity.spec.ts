import { test, expect } from '../auth';
import { ActivityPage } from '../pages/ActivityPage';
import type { Page } from '@playwright/test';

async function waitForActivity(page: Page, activityType: 'SEGMENT_PLAY' | 'SHARE') {
  await expect
    .poll(async () => {
      const response = await page.request.get('/v1/user/activity?take=20');
      if (!response.ok()) return false;

      const data = (await response.json()) as { activities?: Array<{ activityType?: string }> };
      return (data.activities ?? []).some((activity) => activity.activityType === activityType);
    }, {
      timeout: 15_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);
}

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
    await searchInput.fill('ギター');
    await searchInput.press('Enter');

    // Click the audio play button on the first result
    const playButton = authenticatedPage.getByTestId('audio-play-button').first();
    await expect(playButton).toBeVisible({ timeout: 15_000 });
    await playButton.click();
    await waitForActivity(authenticatedPage, 'SEGMENT_PLAY');

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
    await searchInput.fill('ギター');
    await searchInput.press('Enter');

    // Click the share button on the first result
    const shareButton = authenticatedPage.getByTestId('share-button').first();
    await expect(shareButton).toBeVisible({ timeout: 15_000 });
    await shareButton.click();
    await waitForActivity(authenticatedPage, 'SHARE');

    // Check activity history shows a Share entry
    const activity = new ActivityPage(authenticatedPage);
    await activity.goto();
    await activity.expectLoaded();

    await expect(activity.activityRowByText('Share').first()).toBeVisible({ timeout: 10_000 });
  });
});
