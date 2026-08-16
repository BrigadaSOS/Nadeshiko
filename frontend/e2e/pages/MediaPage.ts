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
  readonly mediaGrid: Locator;
  readonly mediaCardContainers: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mediaCards = page.getByTestId('media-card');
    this.searchInput = page.getByTestId('media-search-input');
    this.categoryDropdown = page.getByTestId('media-category-dropdown');
    this.gridViewButton = page.getByTestId('grid-view-button');
    this.listViewButton = page.getByTestId('list-view-button');
    this.listItems = page.getByTestId('media-list-item');
    this.heading = page.getByRole('heading', { level: 1 });
    this.mediaGrid = page.getByTestId('media-grid');
    this.mediaCardContainers = page.getByTestId('media-card-container');
  }

  async goto(query?: Record<string, string>) {
    const params = query ? `?${new URLSearchParams(query)}` : '';
    await this.page.goto(`/media${params}`);
  }

  async expectLoaded() {
    await expect(this.mediaCardContainers.first()).toBeVisible({ timeout: 15_000 });
  }

  async expectListLoaded() {
    await expect(this.listItems.first()).toBeVisible({ timeout: 15_000 });
  }

  /**
   * A card now opens the title's own page at `/media/<slug>`, not the old
   * `/search?media=<publicId>` browse -- that URL is a permanent redirect onto
   * this one. The wait is on the destination rather than on the redirect, so a
   * card that stopped linking anywhere still fails here.
   */
  async clickFirstMedia() {
    await this.mediaCardContainers.first().getByTestId('media-card-title').click();
    await this.page.waitForURL(/\/media\/[^/?]+$/);
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  getMediaCount() {
    return this.mediaCards.count();
  }
}
