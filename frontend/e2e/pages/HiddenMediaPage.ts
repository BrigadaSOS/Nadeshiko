import { type Locator, type Page, expect } from '@playwright/test';

/**
 * The hiding half of the single Manage Media card on `/user/media`.
 *
 * Hiding and favoriting are two controls on one row of one list, so the hidden
 * "list" is the marked rows whose eye is off -- hence `data-hidden` rather than
 * a list-specific testid.
 */
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

  /** Hiding and favoriting share the one media tab; `/user/hide-media` now 301s here. */
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

  /**
   * One card, one list: catalogue results while the box has text, the titles
   * you have marked once it is empty. Emptying it is how you get back to the
   * marked list after acting on a search result.
   */
  async clearSearch() {
    await this.searchInput.fill('');
    await expect(this.searchResults).toHaveCount(0);
  }

  /** By testid, not by label: a lookup row now carries a hide button AND a favorite one. */
  async hideMedia(row: Locator) {
    await row.getByTestId('media-lookup-hide').click();
  }

  async unhideFromList(row: Locator) {
    await row.getByTestId('media-lookup-hide').click();
  }
}
