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
    /**
     * The play write, recorded INSIDE THE PAGE, because it cannot be read from
     * the outside any more.
     *
     * `withRetry` in the SDK hands every attempt `input.clone()`, so a retry is
     * never fed an already-consumed body (`packages/nadeshiko-sdk/src/retry.ts`
     * -- it fixed ~70 reports of "Request object that has already been used").
     * A cloned `Request` carries its body as a STREAM, and Chromium does not
     * expose a streamed body to Playwright: `request.postData()` and
     * `postDataBuffer()` both come back null. The predicate this replaces
     * matched on `postData().includes('SEGMENT_PLAY')`, so from that commit on
     * it could not match any write at all and this test could not pass however
     * well playback worked.
     *
     * Wrapping `fetch` reads the body at the one point it is still a string.
     * `addInitScript` runs before the app's own scripts, and the SDK captures
     * `globalThis.fetch` at module init, so the wrapper is what it captures.
     * Re-run on every navigation, which also resets the list -- the click below
     * navigates nowhere, so the only writes here are the ones it caused.
     */
    await authenticatedPage.addInitScript(() => {
      const writes: string[] = [];
      (window as unknown as { __activityWrites: string[] }).__activityWrites = writes;
      const original = window.fetch;
      window.fetch = async (input, init) => {
        try {
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          if (url.includes('/v1/user/activity')) {
            const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
            writes.push(typeof body === 'string' ? body : '');
          }
        } catch {
          // Instrumentation must never break the request it is watching.
        }
        return original(input, init);
      };
    });

    // Navigate to search and find results
    await authenticatedPage.goto('/search');
    const searchInput = authenticatedPage.getByTestId('search-input');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await searchInput.fill('ギター');
    await searchInput.press('Enter');

    // Click the audio play button on the first result
    const playButton = authenticatedPage.getByTestId('audio-play-button').first();
    await expect(playButton).toBeVisible({ timeout: 15_000 });

    /**
     * Visible is not yet clickable, and that gap was the other half of this
     * failure. Clicking the instant the button appears lands before the result
     * list has settled and its handler is bound, and the click then does
     * nothing at all -- no audio element, no request, no write, and a 45s wait
     * for something that was never going to happen. Measured against staging on
     * 2026-08-27: clicking on `visible` started playback in 3 runs out of 5;
     * waiting for the list to settle first started it in 5 out of 5.
     */
    await authenticatedPage.waitForLoadState('networkidle').catch(() => {});
    await expect(playButton).toBeEnabled({ timeout: 10_000 });

    /**
     * Waiting on the write rather than polling for its result.
     *
     * The activity is only recorded once `audio.play()` RESOLVES -- see
     * `startAudio` in the player store -- so this waits on a real clip being
     * fetched from the CDN and decoded, which on a CI runner is neither instant
     * nor reliably under any particular number of seconds. Polling the activity
     * list for 15s was really a 15s budget for the network, and it ran out often
     * enough to make this the flakiest test in the suite.
     *
     * Matched on the BODY, not just the endpoint: the search a few lines up
     * posts to the same route, and a SEARCH write landing late would satisfy a
     * waiter that only checked the URL -- passing this test without any audio
     * having played.
     */
    await playButton.click();
    await authenticatedPage.waitForFunction(
      () =>
        ((window as unknown as { __activityWrites?: string[] }).__activityWrites ?? []).some((body) =>
          body.includes('SEGMENT_PLAY'),
        ),
      null,
      { timeout: 45_000 },
    );

    // Still asked for afterwards: the write returning 200 is not the same as it
    // being readable, and the history below is rendered from the read side.
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
