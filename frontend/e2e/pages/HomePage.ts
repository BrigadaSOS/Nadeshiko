import { type Locator, type Page, expect } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  readonly mediaCards: Locator;
  readonly statsSection: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Nadeshiko', exact: true });
    this.searchInput = page.getByTestId('search-input');
    this.searchButton = page.getByTestId('search-button');
    this.mediaCards = page.getByTestId('media-card');
    this.statsSection = page.getByTestId('stats-section');
  }

  async goto() {
    await this.page.goto('/');
  }

  async search(query: string) {
    await this.expectLoaded();
    await this.searchInput.click();
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
    await this.page.waitForURL(/\/search\//, { timeout: 10_000 });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 10_000 });
    await expect(this.searchInput).toBeVisible();
  }

  async expectRecentMediaVisible() {
    await expect(this.mediaCards.first()).toBeVisible({ timeout: 10_000 });
  }

  async expectStatsVisible() {
    await expect(this.statsSection).toBeVisible({ timeout: 10_000 });
  }
}
