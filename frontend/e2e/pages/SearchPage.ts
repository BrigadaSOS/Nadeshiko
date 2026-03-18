import { type Locator, type Page, expect } from '@playwright/test';

export class SearchPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly categoryTabs: Locator;
  readonly segmentCards: Locator;
  readonly segmentImages: Locator;
  readonly endOfResults: Locator;
  readonly enToggle: Locator;
  readonly esToggle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.locator('#sentence-search-input');
    this.searchButton = page.locator('button').filter({ has: page.locator('circle') }).first();
    this.categoryTabs = page.locator('.search-tabs-row');
    this.segmentCards = page.locator('.group.flex.flex-col');
    this.segmentImages = page.locator('img[alt^="Screenshot for"]');
    this.endOfResults = page.getByText("You've reached the end", { exact: false });
    this.enToggle = page.getByRole('button', { name: 'EN', exact: true });
    this.esToggle = page.getByRole('button', { name: 'ES', exact: true });
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

  translationBadges(lang: 'EN' | 'ES') {
    return this.segmentCards.first().locator(`span:text-is("${lang}")`).first();
  }

  translationText(lang: 'EN' | 'ES') {
    return this.segmentCards
      .first()
      .locator('li')
      .filter({ has: this.page.locator(`span:text-is("${lang}")`) })
      .locator('.group\\/translation span')
      .first();
  }
}
