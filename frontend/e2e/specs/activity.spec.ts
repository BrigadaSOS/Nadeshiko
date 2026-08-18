import { test, expect } from '../auth';
import { ActivityPage } from '../pages/ActivityPage';
import type { Page } from '@playwright/test';

async function waitForActivity(page: Page, activityType: 'SEGMENT_PLAY' | 'SHARE') {
  await expect
    .poll(async () => {
      // Asked for by TYPE rather than reading the newest 20 of everything. The
      // E2E account is shared by the whole suite, which runs its files in
      // parallel: a page of 20 mixed activities is filled by other specs
      // searching -- each search records one -- so the play this is waiting for
      // could be pushed off the page within the poll window and never be seen.
      // Filtering makes the answer about this action rather than about how busy
      // the account was while it ran.
      const response = await page.request.get(`/v1/user/activity?activityType=${activityType}&take=20`);
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

  /**
   * The initial load has to succeed ON THE SERVER, not merely end up on screen.
   *
   * Its handler pulls the stats, the history, the heatmap and the studied-titles
   * ranking together, so anything throwing inside it takes all four down at
   * once: `useAsyncData` writes a `NuxtError` into the payload where their data
   * belonged, and the page falls back to re-fetching every one of them from the
   * browser. It still *looks* right, which is why this reads the server's own
   * HTML rather than the rendered page.
   *
   * Honest about its reach: this asserts the invariant (the pass ran and
   * answered), not a specific bug. The failure that prompted it -- a Pinia
   * instance missing inside the handler -- was seen once on a live render and
   * has not reproduced on demand, so this has never been observed going red.
   * It is cheap, and it is the assertion that would catch the shape of it.
   */
  test('renders its initial load on the server, without falling back to the client', async ({
    authenticatedPage,
  }) => {
    const html = await (await authenticatedPage.request.get('/en/user/activity')).text();

    expect(html, 'the initial-load payload key should be present').toContain('settings-activity-initial');
    expect(html, 'a handler that threw leaves a NuxtError in the payload').not.toContain('NuxtError');
    expect(html, 'reaching for a store inside the handler breaks it on the server').not.toContain('getActivePinia');
    // Set only on the path where the server pass actually answered.
    expect(html, 'the server pass must have answered, not merely run').toContain('fetchedOnServer');
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
