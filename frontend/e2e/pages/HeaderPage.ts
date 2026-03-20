import { type Locator, type Page, expect } from '@playwright/test';

export class HeaderPage {
  readonly page: Page;
  readonly profileButton: Locator;
  readonly settingsLink: Locator;
  readonly ankiLink: Locator;
  readonly collectionsLink: Locator;
  readonly activityLink: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.profileButton = page.getByRole('button', { name: 'Profile' });
    this.settingsLink = page.getByTestId('nav-settings');
    this.ankiLink = page.getByTestId('nav-anki');
    this.collectionsLink = page.getByTestId('nav-collections');
    this.activityLink = page.getByTestId('nav-activity');
    this.loginButton = page.getByTestId('nav-login');
  }

  async openProfileDropdown() {
    await this.profileButton.click();
  }

  async expectAuthLinks() {
    await expect(this.settingsLink).toBeVisible();
    await expect(this.ankiLink).toBeVisible();
    await expect(this.collectionsLink).toBeVisible();
    await expect(this.activityLink).toBeVisible();
    await expect(this.loginButton).not.toBeVisible();
  }

  async expectGuestLinks() {
    await expect(this.loginButton).toBeVisible();
    await expect(this.settingsLink).not.toBeVisible();
    await expect(this.ankiLink).not.toBeVisible();
    await expect(this.collectionsLink).not.toBeVisible();
    await expect(this.activityLink).not.toBeVisible();
  }
}
