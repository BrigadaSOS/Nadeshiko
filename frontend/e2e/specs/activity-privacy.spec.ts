import type { Page } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../auth';
import { ActivityPage } from '../pages/ActivityPage';

/**
 * The two switches on `/user/activity` that say what the account is allowed to
 * remember, driven through the UI and verified at the API.
 *
 * WHY THROUGH THE UI. Both promises are kept by a single line a long way from
 * the switch -- `UserActivity.trackForUser` returns early on `searchHistory`,
 * and `activityController` skips the affinity tally on `familiarMedia` -- while
 * the client posts activity unconditionally either way. Every link in that chain
 * had a test except the one that matters: that flipping the switch a reader can
 * see reaches the line that does the work. A break in between looks exactly like
 * working software from the outside, and the failure is that we keep recording
 * someone who asked us not to.
 *
 * EACH TEST SIGNS IN FRESH, and that is not ceremony. SSR caches the session and
 * its preferences for 30s per session cookie, so a page rendered after a
 * preference change on the same cookie can still be showing the previous value
 * -- and a switch rendered stale sends the *opposite* instruction when clicked.
 * A new session has nothing cached under it. Same reasoning as the default
 * search category tests in `user-settings.spec.ts`.
 *
 * Every test restores what it changed, including on failure.
 */

const QUERY_PREFIX = 'ゑびす';

async function preferences(page: Page): Promise<Record<string, any>> {
  const response = await page.request.get('/v1/user/preferences');
  return response.ok() ? await response.json() : {};
}

async function searchQueries(page: Page): Promise<string[]> {
  const response = await page.request.get('/v1/user/activity?activityType=SEARCH&take=100');
  // Same reason as `familiarMediaIds`: an unread response reads as "nothing was
  // recorded", which is exactly what the off-switch tests claim to prove.
  expect(response, await response.text()).toBeOK();
  const data = (await response.json()) as { activities?: Array<{ searchQuery?: string }> };
  return (data.activities ?? []).map((activity) => activity.searchQuery ?? '');
}

async function familiarMediaIds(page: Page): Promise<string[]> {
  const response = await page.request.get('/v1/user/familiar-media');
  // Not swallowed: a 429 reads as an empty tally, which would make the
  // "nothing was counted" assertions pass for the wrong reason.
  expect(response, await response.text()).toBeOK();
  const data = (await response.json()) as { familiarMedia?: Array<{ media?: { publicId?: string } }> };
  return (data.familiarMedia ?? []).map((entry) => entry.media?.publicId ?? '');
}

/** A title that really exists, taken from a search rather than hard-coded. */
async function someMediaPublicId(page: Page): Promise<string> {
  await page.goto(`/search/${encodeURIComponent('学校')}`);
  const link = page.getByTestId('segment-card').first().locator('a[href*="media="]').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  const href = (await link.getAttribute('href'))!;
  return new URL(href, 'http://localhost').searchParams.get('media')!;
}

/** Searches the way a reader does, so what is recorded is what the app records. */
async function searchFor(page: Page, query: string): Promise<void> {
  await page.goto(`/search/${encodeURIComponent(query)}`);
  await expect(page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 15_000 });
}

/**
 * Unique per run. A query left in the history by an earlier run would make the
 * "was not recorded" assertion pass for the wrong reason -- and pass forever.
 */
const uniqueQuery = () => `${QUERY_PREFIX}${Date.now()}`;

test.describe('Activity privacy', () => {
  // Serial, because every test in here changes account-wide preferences: run two
  // at once and one turns tracking off while the other is proving it is on.
  test.describe.configure({ mode: 'serial' });

  test('a search reaches the account while tracking is on', async ({ page }) => {
    // The control for the test below. Without it, "not recorded" could equally
    // mean the search never reached the endpoint at all, and the switch would
    // look like it worked no matter what it did.
    await loginAsE2EUser(page);
    const query = uniqueQuery();

    await page.request.patch('/v1/user/preferences', { data: { searchHistory: { enabled: true } } });
    await searchFor(page, query);

    await expect.poll(() => searchQueries(page), { timeout: 15_000 }).toContain(query);
  });

  test('turning activity tracking off stops searches reaching the account', async ({ page }) => {
    await loginAsE2EUser(page);
    const activity = new ActivityPage(page);
    const toggle = page.getByTestId('activity-tracking-toggle');
    const whileOff = uniqueQuery();

    await activity.goto();
    await activity.expectLoaded();

    try {
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await toggle.click();
      await expect
        .poll(async () => (await preferences(page)).searchHistory?.enabled, { timeout: 10_000 })
        .toBe(false);

      await searchFor(page, whileOff);

      // A negative assertion needs a deadline of its own: the row is written
      // asynchronously, so "not there yet" and "never" look alike for a moment.
      // Waiting out a window a recorded search comfortably beats -- the control
      // test above lands well inside it -- is what makes the absence mean
      // something.
      await page.waitForTimeout(3_000);
      expect(await searchQueries(page)).not.toContain(whileOff);
    } finally {
      await page.request.patch('/v1/user/preferences', { data: { searchHistory: { enabled: true } } });
    }
  });

  test('the tracking switch flips back on from the page it was turned off on', async ({ page }) => {
    // Both directions in one page load, deliberately: it is the second click
    // that a reader who changed their mind depends on, and rendering the page
    // again in between is what the SSR cache makes unreliable.
    await loginAsE2EUser(page);
    const activity = new ActivityPage(page);
    const toggle = page.getByTestId('activity-tracking-toggle');
    const afterResuming = uniqueQuery();

    await activity.goto();
    await activity.expectLoaded();

    try {
      await toggle.click();
      await expect
        .poll(async () => (await preferences(page)).searchHistory?.enabled, { timeout: 10_000 })
        .toBe(false);

      await toggle.click();
      await expect
        .poll(async () => (await preferences(page)).searchHistory?.enabled, { timeout: 10_000 })
        .toBe(true);

      await searchFor(page, afterResuming);
      await expect.poll(() => searchQueries(page), { timeout: 15_000 }).toContain(afterResuming);
    } finally {
      await page.request.patch('/v1/user/preferences', { data: { searchHistory: { enabled: true } } });
    }
  });

  test('turning the study tally off stops it counting, and back on resumes it', async ({ page }) => {
    await loginAsE2EUser(page);
    const activity = new ActivityPage(page);
    const toggle = page.getByTestId('familiar-media-toggle');
    const mediaPublicId = await someMediaPublicId(page);

    // The tally, not the history. This test owns the affinity rows and starts
    // from none, so a title showing up afterwards can only be one it counted.
    await page.request.delete('/v1/user/familiar-media');
    await page.request.patch('/v1/user/preferences', { data: { familiarMedia: { enabled: true } } });

    await activity.goto();
    await activity.expectLoaded();

    try {
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await toggle.click();
      await expect
        .poll(async () => (await preferences(page)).familiarMedia?.enabled, { timeout: 10_000 })
        .toBe(false);

      const whileOffRecord = await page.request.post('/v1/user/activity', {
        data: { activityType: 'ANKI_EXPORT', mediaPublicId },
      });
      expect(whileOffRecord, await whileOffRecord.text()).toBeOK();
      await page.waitForTimeout(3_000);
      expect(await familiarMediaIds(page)).not.toContain(mediaPublicId);

      await toggle.click();
      await expect
        .poll(async () => (await preferences(page)).familiarMedia?.enabled, { timeout: 10_000 })
        .toBe(true);

      await page.request.post('/v1/user/activity', { data: { activityType: 'ANKI_EXPORT', mediaPublicId } });
      await expect.poll(() => familiarMediaIds(page), { timeout: 15_000 }).toContain(mediaPublicId);
    } finally {
      await page.request.patch('/v1/user/preferences', { data: { familiarMedia: { enabled: true } } });
      await page.request.delete('/v1/user/familiar-media');
    }
  });

  test('forgetting the study tally empties the list it is shown in', async ({ page }) => {
    await loginAsE2EUser(page);
    const activity = new ActivityPage(page);
    const mediaPublicId = await someMediaPublicId(page);

    await page.request.patch('/v1/user/preferences', { data: { familiarMedia: { enabled: true } } });
    await page.request.post('/v1/user/activity', { data: { activityType: 'ANKI_EXPORT', mediaPublicId } });
    await expect.poll(() => familiarMediaIds(page), { timeout: 15_000 }).toContain(mediaPublicId);

    await activity.goto();
    await activity.expectLoaded();
    await expect(page.getByTestId('familiar-media-list')).toBeVisible({ timeout: 10_000 });

    // The button confirms first, and an unhandled dialog auto-dismisses -- which
    // would leave this test asserting that nothing happened.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('familiar-media-clear').click();

    await expect(page.getByTestId('familiar-media-list')).toHaveCount(0, { timeout: 10_000 });
    expect(await familiarMediaIds(page)).not.toContain(mediaPublicId);
  });
});
