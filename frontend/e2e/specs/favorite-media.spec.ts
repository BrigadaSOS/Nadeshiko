import { test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';
import { FavoriteMediaPage } from '../pages/FavoriteMediaPage';

test.describe('Favorite Media', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ authenticatedPage }) => {
    const response = await authenticatedPage.request.get('/v1/user/favorite-media');
    const { favoriteMedia } = await response.json();
    for (const media of favoriteMedia) {
      await authenticatedPage.request.delete(`/v1/user/favorite-media/${media.publicId}`);
    }

    // Hidden titles too: favoriting and hiding now share one card and one list,
    // so its empty state is "nothing marked either way" -- a title left hidden
    // by another spec keeps the list on screen with no favorites in it.
    const hidden = await authenticatedPage.request.get('/v1/user/excluded-media');
    const { excludedMedia } = await hidden.json();
    for (const media of excludedMedia) {
      await authenticatedPage.request.delete(`/v1/user/excluded-media/${media.publicId}`);
    }
  });

  test('displays the starred media page', async ({ authenticatedPage }) => {
    const favorites = new FavoriteMediaPage(authenticatedPage);
    await favorites.goto();
    await favorites.expectLoaded();

    await expect(favorites.favoriteItems).toHaveCount(0);
    await expect(favorites.noFavoritesMessage).toBeVisible();
  });

  test('stars and unstars media from the settings page', async ({ authenticatedPage }) => {
    const favorites = new FavoriteMediaPage(authenticatedPage);
    await favorites.goto();
    await favorites.expectLoaded();

    await favorites.searchMedia('Death');
    const searchRow = favorites.searchResultByName('Death Note');
    await expect(searchRow).toBeVisible();
    await favorites.starMedia(searchRow);

    // The one list shows catalogue results while the box has text; emptying it
    // brings back the titles already marked.
    await favorites.clearSearch();
    await expect(favorites.favoriteItemByName('Death Note')).toBeVisible({ timeout: 10_000 });

    await favorites.unstarFromList(favorites.favoriteItemByName('Death Note'));
    await expect(favorites.favoriteItemByName('Death Note')).not.toBeVisible({ timeout: 10_000 });
  });

  /**
   * Everything that reads the filter itself, in its own block so the widened
   * viewport below applies to these and nothing else.
   *
   * The filter is the desktop sidebar, `hidden 2xl:grid`. At the project's
   * default 1280px it is `display:none` and the mobile drawer holding the other
   * copy is not mounted, so the stars these tests look for could never be
   * visible.
   *
   * `test.use` is scoped to the DESCRIBE it sits in, not to the tests that
   * follow it -- a test declared above the call still gets the widened viewport.
   * This block is what makes "only these" true rather than merely intended.
   */
  test.describe('the search media filter', () => {
    test.use({ viewport: { width: 1600, height: 900 } });

    test('sorts a starred title to the top of the search media filter', async ({ authenticatedPage }) => {
      // The point of the whole feature: a title that alphabetical order would bury
      // sits first once starred, and sinks back the moment it is unstarred.
      const favorites = new FavoriteMediaPage(authenticatedPage);
      await favorites.goto();
      await favorites.expectLoaded();
      await favorites.searchMedia('Death');
      await favorites.starMedia(favorites.searchResultByName('Death Note'));
      await favorites.clearSearch();
      await expect(favorites.favoriteItemByName('Death Note')).toBeVisible({ timeout: 10_000 });

      await authenticatedPage.goto('/search/'.concat(encodeURIComponent('私')));

      // The filter is built from the stats response, so wait for the list to
      // exist before asking about the stars inside it. Going straight for a star
      // makes a page that is merely still loading fail as "element(s) not
      // found", which reads like the feature is broken.
      await expect(authenticatedPage.locator('[data-testid="media-filter-row"]').first()).toBeVisible({
        timeout: 20_000,
      });

      // Row 0 is the "All" row, which is pinned regardless of any ordering.
      const mediaRows = authenticatedPage.locator('[data-testid="media-filter-favorite"]');
      await expect(mediaRows.first()).toBeVisible({ timeout: 15_000 });

      const firstTitle = authenticatedPage
        .locator('[data-testid="media-filter-row"]')
        .filter({ has: mediaRows.first() })
        .first();
      await expect(firstTitle).toContainText('Death Note');
    });

    test('the All row carries no star, while the title rows do', async ({ authenticatedPage }) => {
      // The All row is not a title, so there is nothing to favorite on it and it
      // gets no star rather than a disabled one that explains nothing. The rule
      // lives inside the star component: `mediaPublicId` is nullable on a filter
      // row, and a `v-for` alias does not narrow through a template `v-if` into a
      // prop type, so a guard at the call site type-checked nowhere.
      await authenticatedPage.goto('/search/'.concat(encodeURIComponent('私')));

      const rows = authenticatedPage.locator('[data-testid="media-filter-row"]');
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      await expect(rows.first().locator('[data-testid="media-filter-favorite"]')).toHaveCount(0);

      // And not because stars are missing everywhere -- the titles below it have one.
      await expect(authenticatedPage.locator('[data-testid="media-filter-favorite"]').first()).toBeVisible({
        timeout: 15_000,
      });
    });

    test('stars a title from the filter itself, and a fresh render agrees', async ({ authenticatedPage }) => {
      // The settings page is not the only way in: the filter's own star writes the
      // same preference. Checked through a fresh server render rather than the
      // button's own state, because the preferences a render is built from are
      // fetched and cached server-side -- a change invisible there is the bug that
      // made saving look like it had not applied.
      await authenticatedPage.goto('/search/'.concat(encodeURIComponent('私')));

      // Pinned by `data-row-id` before clicking, because favoriting re-sorts the
      // list: a locator like "the first unstarred star" resolves to a *different*
      // row the moment the one it matched moves to the top, and then asserts
      // against whatever slid into its place.
      const unstarredRow = authenticatedPage
        .locator('[data-testid="media-filter-row"][data-row-id]')
        .filter({ has: authenticatedPage.locator('[data-testid="media-filter-favorite"][aria-pressed="false"]') })
        .first();
      await expect(unstarredRow).toBeVisible({ timeout: 15_000 });
      const rowId = await unstarredRow.getAttribute('data-row-id');
      expect(rowId).toBeTruthy();

      const star = authenticatedPage.locator(`[data-row-id="${rowId}"] [data-testid="media-filter-favorite"]`);
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'true');

      // The render is compared against the account rather than against a count
      // this test picked, which is the property that actually matters: what the
      // server rendered has to be what the account holds, not what the page it
      // came from happened to remember.
      const stored = await authenticatedPage.request.get('/v1/user/favorite-media');
      const { favoriteMedia } = await stored.json();
      expect(favoriteMedia.length).toBeGreaterThan(0);

      const favorites = new FavoriteMediaPage(authenticatedPage);
      await favorites.goto();
      await favorites.expectLoaded();
      await expect(favorites.favoriteItems).toHaveCount(favoriteMedia.length);

      // Put it back. This file is `mode: 'serial'` and the title starred here is
      // whichever one happened to be unstarred, so leaving it behind hands the
      // next test a favorite it never asked for -- which is exactly how the
      // sort-to-top test came to assert against somebody else's title.
      await authenticatedPage.request.delete(`/v1/user/favorite-media/${rowId}`);
    });

    test('shows no star control to a signed-out reader', async ({ browser }) => {
      // A context built by hand, because this spec runs in the authenticated
      // project: its `page` carries the project's `storageState` and is signed in
      // like every other test here, so asserting "no star" against it only passed
      // while the stored session happened to be stale. Same shape as the anonymous
      // check in collections.spec.ts, and it has to re-declare the bypass headers
      // for the same reason -- a hand-built context does not inherit `use`.
      const anonymous = await browser.newContext({
        baseURL: getE2EBaseUrl(),
        storageState: undefined,
        viewport: { width: 1600, height: 900 },
        extraHTTPHeaders: e2eBypassHeaders(),
      });
      try {
        const page = await anonymous.newPage();
        await page.goto('/search/'.concat(encodeURIComponent('私')));
        // The rows themselves must be there, or "no stars" is just an empty filter.
        await expect(page.locator('[data-testid="media-filter-row"]').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="media-filter-favorite"]')).toHaveCount(0);
      } finally {
        await anonymous.close();
      }
    });
  });
});
