import { type Locator, type Page, expect } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly username: Locator;
  readonly email: Locator;
  readonly logoutButton: Locator;
  readonly sessionsCard: Locator;
  readonly refreshSessionsButton: Locator;
  readonly logOutOtherDevicesButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.username = page.getByTestId('account-username');
    this.email = page.getByTestId('account-email');
    this.logoutButton = page.getByRole('button', { name: 'Logout' });
    this.sessionsCard = page.getByTestId('sessions-card');
    this.refreshSessionsButton = page.getByRole('button', { name: 'Refresh' });
    this.logOutOtherDevicesButton = page.getByRole('button', { name: 'Log Out Other Devices' });
  }

  async goto() {
    await this.page.goto('/user/settings');
  }

  async expectLoaded() {
    await expect(this.username).toBeVisible({ timeout: 10_000 });
    await expect(this.email).toBeVisible({ timeout: 10_000 });
  }

  get currentSessionRow() {
    return this.sessionsCard.getByTestId('session-row-current');
  }

  get otherSessionRows() {
    return this.sessionsCard.getByTestId('session-row');
  }

  get allSessionRows() {
    return this.sessionsCard.getByTestId(/^session-row/);
  }

  get currentSessionBadge() {
    return this.currentSessionRow.getByText('Current');
  }
}
