import type { Page } from '@playwright/test';

import { test, expect, loginAsE2EUser } from '../auth';
import { MediaPage } from '../pages/MediaPage';

/**
 * The title card on `/media/<slug>`: a one-line row with the work's details
 * folded underneath it.
 *
 * Opening and closing is local to the page and open to anybody, signed in or
 * not. What is stored is only which way it starts, and only for a signed-in
 * reader -- `OPEN` for everyone else. See `useMediaCardDefault`.
 */
test.describe('Media title card', () => {
  /** A slug from whatever the catalogue actually holds, so the suite stays data-independent. */
  const gotoFirstTitle = async (page: Page) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();
    await media.clickFirstMedia();
  };

  const setDefault = (page: Page, mediaCardDefault: 'OPEN' | 'CLOSED') =>
    page.request.patch('/v1/user/preferences', { data: { mediaCardDefault } });

  test('starts open, and the row closes it, for a signed-out reader', async ({ page }) => {
    await page.context().clearCookies();
    await gotoFirstTitle(page);

    const card = page.getByTestId('media-header');
    const toggle = page.getByTestId('media-header-toggle');
    // Resolved through `aria-controls` rather than a second test id: the details
    // region already has to name itself for the chevron to be announced, so
    // reading it here asserts that wiring is intact as a side effect of using it.
    const details = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    await expect(card).toHaveAttribute('data-open', 'true');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const openHeight = (await card.boundingBox())?.height ?? 0;

    // The card itself, not just the chevron: clicking the title toggles it.
    await card.getByRole('heading').click();
    await expect(card).toHaveAttribute('data-open', 'false');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Give the collapse its 300ms before measuring what it collapsed to.
    await expect(async () => {
      expect((await card.boundingBox())?.height ?? 0).toBeLessThan(openHeight);
    }).toPass({ timeout: 5_000 });

    // Closed hides the details; it does not take them out of the page.
    //
    // NOT `toBeHidden()` on the link, which is what this asserted first and why
    // it failed against a build with nothing wrong with it. The collapse is a
    // `grid-template-rows` transition plus an opacity fade, and Playwright's
    // visibility check reads neither: it looks at the element's OWN box and its
    // OWN `visibility`, so a link clipped to nothing by an ancestor's
    // `overflow: hidden`, inside an ancestor at `opacity: 0`, still counts as
    // visible. Measured on staging 2026-08-25: the link kept a 22px box and
    // `opacity: 1` of its own, while `elementFromPoint` at the centre of that box
    // returned a different element entirely. Nobody could see it; only the
    // assertion thought otherwise.
    //
    // So assert the collapse itself. `grid-rows-[0fr]` computes to `0px` closed
    // and `84.5px` open on the same card, which is the mechanism rather than a
    // proxy for it -- and `toHaveCSS` retries, so it rides out the 300ms.
    const anilist = page.getByTestId('media-anilist-link');
    if (await anilist.count()) await expect(anilist).toBeAttached();
    await expect(details).toHaveCSS('grid-template-rows', '0px');

    await card.getByRole('heading').click();
    await expect(card).toHaveAttribute('data-open', 'true');
  });

  test.describe('signed in', () => {
    test.describe.configure({ mode: 'serial' });

    /**
     * Signs in fresh rather than reusing the shared authenticated page: SSR
     * caches the session and its preferences for 30s per session cookie, so a
     * render right after a preference change on the same cookie can still be
     * serving the previous value.
     */
    test('CLOSED starts the card closed', async ({ page }) => {
      await loginAsE2EUser(page);

      try {
        await setDefault(page, 'CLOSED');
        await gotoFirstTitle(page);

        await expect(page.getByTestId('media-header')).toHaveAttribute('data-open', 'false');
        // Still openable from the page, which is the point of it being a default.
        await page.getByTestId('media-header-toggle').click();
        await expect(page.getByTestId('media-header')).toHaveAttribute('data-open', 'true');
      } finally {
        await setDefault(page, 'OPEN');
      }
    });

    test('opening the card does not rewrite the setting', async ({ page }) => {
      await loginAsE2EUser(page);

      try {
        await setDefault(page, 'CLOSED');
        await gotoFirstTitle(page);
        await page.getByTestId('media-header').getByRole('heading').click();
        await expect(page.getByTestId('media-header')).toHaveAttribute('data-open', 'true');

        const stored = await (await page.request.get('/v1/user/preferences')).json();
        expect(stored.mediaCardDefault).toBe('CLOSED');
      } finally {
        await setDefault(page, 'OPEN');
      }
    });
  });
});
