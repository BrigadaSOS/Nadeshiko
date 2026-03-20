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
    this.searchInput = page.getByTestId('search-input');
    this.searchButton = page.getByTestId('search-button');
    this.categoryTabs = page.getByTestId('search-category-tabs');
    this.segmentCards = page.getByTestId('segment-card');
    this.segmentImages = page.getByTestId('segment-image');
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
    return this.segmentCards.first().getByTestId(`translation-badge-${lang}`).first();
  }

  translationText(lang: 'EN' | 'ES') {
    return this.segmentCards
      .first()
      .getByTestId(`translation-row-${lang}`)
      .getByTestId('translation-content');
  }
}
