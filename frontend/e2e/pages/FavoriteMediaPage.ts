import { type Locator, type Page, expect } from '@playwright/test';

// Manage Media switches between catalogue search results and marked titles. Both use
// the same controls; favorites are marked rows with data-favorite, not a separate list.
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

  // Emptying the search returns to the marked-title list.
  async clearSearch() {
    await this.searchInput.fill('');
    await expect(this.searchResults).toHaveCount(0);
  }

  // Wait for the account write, not just optimistic UI, before a subsequent SSR navigation.
  async starMedia(row: Locator) {
    await this.toggleFavorite(row);
  }

  async unstarFromList(row: Locator) {
    await this.toggleFavorite(row);
  }

  private async toggleFavorite(row: Locator) {
    const written = this.page.waitForResponse(
      (response) => /\/v1\/user\/favorite-media/.test(response.url()) && response.request().method() !== 'GET',
      { timeout: 15_000 },
    );
    await row.getByTestId('media-lookup-favorite').click();
    await written;
  }
}
