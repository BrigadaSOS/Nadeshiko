import { type Locator, type Page, expect } from '@playwright/test';

export class SearchPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly categoryTabs: Locator;
  readonly segmentCards: Locator;
  readonly segmentImages: Locator;
  readonly endOfResults: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('#sentence-search-input');
    this.searchButton = page.locator('button').filter({ has: page.locator('circle') }).first();
    this.categoryTabs = page.locator('.search-tabs-row');
    this.segmentCards = page.locator('.group.flex.flex-col');
    this.segmentImages = page.locator('img[alt^="Screenshot for"]');
    this.endOfResults = page.getByText('End of results', { exact: false });
  }

  async goto(query?: string) {
    if (query) {
      await this.page.goto(`/search/${encodeURIComponent(query)}`);
    } else {
      await this.page.goto('/search');
    }
  }

  async search(query: string) {
    await this.searchInput.clear();
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForURL(/\/search\//, { timeout: 10_000 });
  }

  async expectResultsVisible() {
    await expect(this.segmentCards.first()).toBeVisible({ timeout: 15_000 });
  }

  async expectCategoryTabsVisible() {
    await expect(this.categoryTabs).toBeVisible({ timeout: 15_000 });
  }

  async expectNoResults() {
    await expect(this.page.getByText('No results', { exact: false }).or(this.endOfResults)).toBeVisible({
      timeout: 10_000,
    });
  }

  getResultCount() {
    return this.segmentCards.count();
  }
}
