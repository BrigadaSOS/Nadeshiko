import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

/**
 * The recents menu for a signed-out reader, which is the device list on its own
 * -- no account rows merged in. Anonymous is also the interesting half: it is
 * the population whose history is local-only, and the one that would notice a
 * menu that opened by itself on arrival at every page.
 */
test.describe('Recent searches', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
  });

  /**
   * A list to open the menu on. Every test gets a fresh browser context, so the
   * ones about narrowing, forgetting and clearing seed the device list rather
   * than running searches to build it -- recording is what the first test is
   * for. Only when the key is absent, so a reload after a forget does not put
   * back what the test just deleted.
   */
  async function seedRecents(page: Page) {
    const stored = JSON.stringify({
      v: 1,
      entries: [
        { query: '猫', searchedAt: '2026-08-14T10:00:00.000Z', ids: [] },
        { query: '学校', searchedAt: '2026-08-14T09:00:00.000Z', ids: [] },
      ],
      dismissed: {},
    });

    await page.addInitScript((payload) => {
      if (!window.localStorage.getItem('nd-search-recents')) {
        window.localStorage.setItem('nd-search-recents', payload);
      }
    }, stored);
  }

  test('a search arrives in the list without being typed into the bar', async () => {
    // Straight to the URL, the way a link from a dictionary extension or a
    // clicked token arrives. Recording is on arrival, not on submit.
    await search.goto('学校');
    await search.expectResultsVisible();

    await search.goto('猫');
    await search.expectResultsVisible();

    // Asked for from an empty box, which is the unnarrowed case: on a results
    // page the bar arrives holding the query that answered it, so the menu
    // there is already narrowed to that one row.
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    await expect(search.recentsItems).toHaveCount(2);
    await expect(search.recentsItems.first()).toContainText('猫');
  });

  /**
   * The id of a title that answers this query, taken off a result card's own
   * media link. `?media=` alongside the query is what the results page's media
   * filter writes, and what a shared scoped URL arrives as.
   */
  async function firstMediaId(page: Page): Promise<string> {
    const link = page.getByTestId('segment-card').first().locator('a[href*="media="]').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = (await link.getAttribute('href')) ?? '';
    const id = new URL(href, 'http://localhost').searchParams.get('media');
    expect(id).toBeTruthy();
    return id as string;
  }

  test('a search inside one title is its own row, and goes back to that title', async ({ page }) => {
    await search.goto('学校');
    await search.expectResultsVisible();
    const mediaId = await firstMediaId(page);

    // The same query again, narrowed to one title.
    await page.goto(`/search/${encodeURIComponent('学校')}?media=${mediaId}`);
    await search.expectResultsVisible();

    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    // Two rows for one query: the general search and the one inside the title.
    await expect(search.recentsItem('学校')).toHaveCount(2);
    await expect(search.recentsMenu.getByTestId('search-recents-media')).toHaveCount(1);

    await search.recentsMenu.getByTestId('search-recents-media').locator('..').click();

    await page.waitForURL(new RegExp(`media=${mediaId}`), { timeout: 10_000 });
    await expect(search.searchInput).toHaveValue('学校');
  });

  test('a general row run from inside a title leaves that title behind', async ({ page }) => {
    await seedRecents(page);
    await search.goto('学校');
    await search.expectResultsVisible();
    const mediaId = await firstMediaId(page);

    await page.goto(`/search/${encodeURIComponent('学校')}?media=${mediaId}`);
    await search.expectResultsVisible();

    await search.openRecents();
    await search.searchInput.fill('猫');
    await search.recentsItem('猫').first().click();

    // The seeded row carries no title, so re-running it must drop the `media`
    // filter the page was wearing rather than inherit it.
    await page.waitForURL(/\/search\/%E7%8C%AB/, { timeout: 10_000 });
    expect(new URL(page.url()).searchParams.get('media')).toBeNull();
  });

  test('the menu stays shut until the reader asks for it', async ({ page }) => {
    // The bar focuses itself on mount for desktop readers. That focus is not a
    // request for the history, and a menu open on arrival at every page would
    // cover the results underneath it.
    await seedRecents(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    await expect(search.recentsMenu).toBeHidden();
  });

  test('recents narrow as you type', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();
    await expect(search.recentsItems).toHaveCount(2);

    await search.searchInput.fill('猫');

    await expect(search.recentsItems).toHaveCount(1);
    await expect(search.recentsItems.first()).toContainText('猫');
  });

  test('Escape closes the menu and leaves the query alone', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();
    await search.searchInput.fill('猫');

    await page.keyboard.press('Escape');

    await expect(search.recentsMenu).toBeHidden();
    await expect(search.searchInput).toHaveValue('猫');
  });

  test('arrowing onto a row and pressing Enter re-runs that search', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    // Second row: no row is preselected, so the first press is what puts Enter
    // on a recent at all.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await page.waitForURL(/\/search\/%E5%AD%A6%E6%A0%A1/, { timeout: 10_000 });
    await expect(search.searchInput).toHaveValue('学校');
  });

  test('clicking a row re-runs that search', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    await search.recentsItem('学校').first().click();

    await page.waitForURL(/\/search\/%E5%AD%A6%E6%A0%A1/, { timeout: 10_000 });
    await expect(search.searchInput).toHaveValue('学校');
  });

  test('forgetting a row keeps it gone across a reload', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    await search.recentsItem('学校').first().getByTestId('search-recents-forget').click();
    await expect(search.recentsItem('学校')).toHaveCount(0);

    await page.reload();
    await search.expectHydrated();
    await search.openRecents();

    await expect(search.recentsItem('学校')).toHaveCount(0);
    await expect(search.recentsItem('猫')).toHaveCount(1);
  });

  test('opening a result dropdown closes the recents menu', async ({ page }) => {
    await seedRecents(page);
    await search.goto('学校');
    await search.expectResultsVisible();
    await search.openRecents();
    await expect(search.recentsMenu).toBeVisible();

    const copy = search.segmentCards.first().getByTestId('copy-dropdown');
    await copy.getByTestId('dropdown-toggle').click();

    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();
    await expect(search.recentsMenu).toBeHidden();
  });

  test('clearing empties the list', async ({ page }) => {
    await seedRecents(page);
    await search.goto();
    await search.expectHydrated();
    await search.openRecents();

    await search.recentsClear.click();

    // No rows left, so there is no menu to show.
    await expect(search.recentsMenu).toBeHidden();

    await page.reload();
    await search.expectHydrated();
    await search.searchInput.click();
    await expect(search.recentsMenu).toBeHidden();
  });
});
