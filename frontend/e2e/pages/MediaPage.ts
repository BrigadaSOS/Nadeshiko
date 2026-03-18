import { type Locator, type Page, expect } from '@playwright/test';

export class MediaPage {
  readonly page: Page;
  readonly mediaCards: Locator;

  constructor(page: Page) {
    this.page = page;
    this.mediaCards = page.locator('.grid a[href*="/search?media="]');
  }

  async goto() {
    await this.page.goto('/media');
  }

  async expectLoaded() {
    await expect(this.mediaCards.first()).toBeVisible({ timeout: 15_000 });
  }

  async clickFirstMedia() {
    await this.mediaCards.first().click();
    await this.page.waitForURL(/\/search\?media=/);
  }
}
