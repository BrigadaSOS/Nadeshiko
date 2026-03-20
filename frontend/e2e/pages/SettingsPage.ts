import { type Locator, type Page, expect } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly username: Locator;
  readonly email: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page.getByTestId('account-username');
    this.email = page.getByTestId('account-email');
  }

  async goto() {
    await this.page.goto('/user/settings');
  }

  async expectLoaded() {
    await expect(this.username).toBeVisible({ timeout: 10_000 });
    await expect(this.email).toBeVisible({ timeout: 10_000 });
  }
}
