import { type Locator, type Page, expect } from '@playwright/test';

/**
 * The favorites half of the single Manage Media card on `/user/media`.
 *
 * That card is one search box over one list: typing shows catalogue results
 * (`media-lookup-result`), an empty box shows the titles already marked
 * (`managed-media-item`). Both carry the same star and eye controls, so the
 * favorites "list" is the marked rows whose star is on -- hence `data-favorite`
 * rather than a list-specific testid.
 */
export class FavoriteMediaPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly noFavoritesMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId('media-lookup-search-input');
    this.noFavoritesMessage = page.getByText('Nothing favorited or hidden yet.');
  }

  async goto() {
    await this.page.goto('/user/media');
  }

  async expectLoaded() {
    await expect(this.searchInput).toBeVisible({ timeout: 10_000 });
  }

  get searchResults() {
    return this.page.getByTestId('media-lookup-result');
  }

  get favoriteItems() {
    return this.page.locator('[data-testid="managed-media-item"][data-favorite="true"]');
  }

  searchResultByName(name: string) {
    return this.searchResults.filter({ hasText: name });
  }

  favoriteItemByName(name: string) {
    return this.favoriteItems.filter({ hasText: name });
  }

  async searchMedia(query: string) {
    await this.searchInput.fill(query);
    await expect(this.searchResults.first()).toBeVisible({ timeout: 10_000 });
  }

  /**
   * One card, one list: catalogue results while the box has text, the titles
   * you have marked once it is empty. Emptying it is how you get back to the
   * marked list after acting on a search result.
   */
  async clearSearch() {
    await this.searchInput.fill('');
    await expect(this.searchResults).toHaveCount(0);
  }

  /**
   * Clicks the star AND waits for the account to have taken it.
   *
   * The click handler fires the write without awaiting it, and the list updates
   * optimistically -- so a test that only checks the row it just starred is
   * asserting against client state while the POST is still in flight. Navigate
   * on that and the next server render is built from preferences the write has
   * not reached yet: the sort-to-top test failed exactly that way, and only
   * passed when an earlier test happened to have paid the latency first.
   */
  async starMedia(row: Locator) {
    await this.toggleFavorite(row);
  }

  async unstarFromList(row: Locator) {
    await this.toggleFavorite(row);
  }

  private async toggleFavorite(row: Locator) {
    const written = this.page.waitForResponse(
      (response) =>
        /\/v1\/user\/favorite-media/.test(response.url()) && response.request().method() !== 'GET',
      { timeout: 15_000 },
    );
    await row.getByTestId('media-lookup-favorite').click();
    await written;
  }
}
