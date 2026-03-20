import { type Locator, type Page, expect } from '@playwright/test';

export class HiddenMediaPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly noHiddenMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Hide Media' }).first();
    this.searchInput = page.getByTestId('hidden-media-search-input');
    this.noHiddenMessage = page.getByText('No hidden media.');
  }

  async goto() {
    await this.page.goto('/user/hide-media');
  }

  async expectLoaded() {
    await expect(this.searchInput).toBeVisible({ timeout: 10_000 });
  }

  get searchResults() {
    return this.page.getByTestId('hidden-media-search-result');
  }

  get hiddenItems() {
    return this.page.getByTestId('hidden-media-item');
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

  async hideMedia(row: Locator) {
    await row.getByRole('button', { name: 'Hide' }).click();
  }

  async unhideFromList(row: Locator) {
    await row.getByRole('button', { name: 'Unhide' }).click();
  }
}
