import { type Locator, type Page, expect } from '@playwright/test';

// Hidden titles are marked Manage Media rows with data-hidden, not a separate list.
export class HiddenMediaPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly noHiddenMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Manage Media' }).first();
    this.searchInput = page.getByTestId('media-lookup-search-input');
    this.noHiddenMessage = page.getByText('Nothing favorited or hidden yet.');
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

  get hiddenItems() {
    return this.page.locator('[data-testid="managed-media-item"][data-hidden="true"]');
  }

  searchResultByName(name: string) {
    return this.searchResults.filter({ hasText: name });
  }

  hiddenItemByName(name: string) {
    return this.hiddenItems.filter({ hasText: name });
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

  // Use the hide-specific test ID: each row also has a favorite button.
  async hideMedia(row: Locator) {
    await row.getByTestId('media-lookup-hide').click();
  }

  async unhideFromList(row: Locator) {
    await row.getByTestId('media-lookup-hide').click();
  }
}
