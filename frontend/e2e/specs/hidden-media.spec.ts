import { test, expect } from '../auth';
import { HiddenMediaPage } from '../pages/HiddenMediaPage';

test.describe('Hidden Media', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ authenticatedPage }) => {
    const response = await authenticatedPage.request.get('/v1/user/excluded-media');
    const { excludedMedia } = await response.json();
    for (const media of excludedMedia) {
      await authenticatedPage.request.delete(`/v1/user/excluded-media/${media.publicId}`);
    }
  });

  test('displays hidden media page', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();
  });

  /**
   * Both settings moved into one `/user/media` tab. The old paths were linked
   * from the account menu long enough to be bookmarked, so they have to land on
   * the page that now holds their controls -- not on the `/user/**` catch-all,
   * which would drop them at the general settings tab instead.
   */
  test.describe('legacy tab URLs', () => {
    test('/user/hide-media lands on the combined media tab, hiding intact', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/user/hide-media');
      await expect(authenticatedPage).toHaveURL(/\/user\/media$/);
      // Both settings now live in the one Manage Media card this URL lands on.
      await expect(authenticatedPage.getByTestId('media-lookup-search-input')).toBeVisible({ timeout: 10_000 });
      await expect(authenticatedPage.getByRole('heading', { name: 'Manage Media' }).first()).toBeVisible();
    });

    test('/user/favorites lands on the same tab, favoriting intact', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/user/favorites');
      await expect(authenticatedPage).toHaveURL(/\/user\/media$/);
      await expect(authenticatedPage.getByTestId('media-lookup-search-input')).toBeVisible({ timeout: 10_000 });
      await expect(authenticatedPage.getByRole('heading', { name: 'Manage Media' }).first()).toBeVisible();
    });

    test('both settings share one search box', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/user/media');
      const search = authenticatedPage.getByTestId('media-lookup-search-input');
      // Visible before counted: the card is server-rendered, so a bare count can
      // run against the pre-hydration DOM and read the box before Vue attaches.
      await expect(search).toBeVisible({ timeout: 15_000 });
      await expect(search).toHaveCount(1);
      // A lookup row offers both answers, so neither setting needs its own search.
      await search.fill('Death');
      const row = authenticatedPage.getByTestId('media-lookup-result').first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row.getByTestId('media-lookup-favorite')).toBeVisible();
      await expect(row.getByTestId('media-lookup-hide')).toBeVisible();
    });
  });

  test('searches for media and displays results', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    await hiddenMedia.searchMedia('Death');
    await expect(hiddenMedia.searchResultByName('Death Note').first()).toBeVisible();
  });

  test('hides and unhides media', async ({ authenticatedPage }) => {
    const hiddenMedia = new HiddenMediaPage(authenticatedPage);
    await hiddenMedia.goto();
    await hiddenMedia.expectLoaded();

    // Search and hide
    await hiddenMedia.searchMedia('Death');
    const searchRow = hiddenMedia.searchResultByName('Death Note');
    await expect(searchRow).toBeVisible();
    await hiddenMedia.hideMedia(searchRow);

    // Verify it appears in the hidden list. The one list shows catalogue results
    // while the box has text; emptying it brings back the titles already marked.
    await hiddenMedia.clearSearch();
    await expect(hiddenMedia.hiddenItemByName('Death Note')).toBeVisible({ timeout: 10_000 });

    // Unhide from the list
    const hiddenRow = hiddenMedia.hiddenItemByName('Death Note');
    await hiddenMedia.unhideFromList(hiddenRow);

    // Verify it's removed from the hidden list
    await expect(hiddenMedia.hiddenItemByName('Death Note')).not.toBeVisible({ timeout: 10_000 });
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
    await expect(hiddenMedia.searchResults).toHaveCount(0);
  });
});
