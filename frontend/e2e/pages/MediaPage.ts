import { type Locator, type Page, expect } from '@playwright/test';

export class MediaPage {
  readonly page: Page;
  readonly mediaCards: Locator;
  readonly searchInput: Locator;
  readonly categoryDropdown: Locator;
  readonly gridViewButton: Locator;
  readonly listViewButton: Locator;
  readonly listItems: Locator;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mediaCards = page.locator('.grid a[href*="/search?media="]');
    this.searchInput = page.locator('input[placeholder="Search a title here..."]');
    this.categoryDropdown = page.locator('.nd-dropdown-toggle').first();
    this.gridViewButton = page.locator('button').filter({ has: page.locator('path[d*="M3,11H11V3H3"]') });
    this.listViewButton = page.locator('button').filter({ has: page.locator('path[d*="M3,4H7V8H3"]') });
    this.listItems = page.locator('.tab-content .relative.mb-4');
    this.heading = page.getByRole('heading', { level: 1 });
  }

  async goto(query?: Record<string, string>) {
    const params = query ? `?${new URLSearchParams(query)}` : '';
    await this.page.goto(`/media${params}`);
  }

  async expectLoaded() {
    await expect(this.mediaCards.first()).toBeVisible({ timeout: 15_000 });
  }

  async expectListLoaded() {
    await expect(this.listItems.first()).toBeVisible({ timeout: 15_000 });
  }

  async clickFirstMedia() {
    await this.mediaCards.first().click();
    await this.page.waitForURL(/\/search\?media=/);
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  getMediaCount() {
    return this.mediaCards.count();
  }
}
