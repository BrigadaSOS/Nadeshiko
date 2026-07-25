import { type Locator, type Page, expect } from '@playwright/test';

export class DeveloperPage {
  readonly page: Page;
  readonly addApiKeyButton: Locator;
  readonly createModal: Locator;
  readonly createModalNameInput: Locator;
  readonly createModalSubmit: Locator;
  readonly renameModal: Locator;
  readonly renameModalNameInput: Locator;
  readonly renameModalSubmit: Locator;
  readonly keyCreatedAlert: Locator;
  readonly keyDeactivatedAlert: Locator;
  readonly noKeysMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.addApiKeyButton = page.getByTestId('add-api-key-button');
    this.createModal = page.getByTestId('create-apikey-modal');
    this.createModalNameInput = this.createModal.getByRole('textbox');
    this.createModalSubmit = page.getByTestId('create-apikey-submit');
    this.renameModal = page.getByTestId('rename-apikey-modal');
    this.renameModalNameInput = this.renameModal.getByRole('textbox');
    this.renameModalSubmit = page.getByTestId('rename-apikey-submit');
    this.keyCreatedAlert = page.getByTestId('api-key-created-alert');
    this.keyDeactivatedAlert = page.getByTestId('api-key-deactivated-alert');
    this.noKeysMessage = page.getByText('No API keys found');
  }

  private waitForApiResponse(path: string, method: string) {
    return this.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === path && response.request().method() === method && response.ok(),
      { timeout: 15_000 },
    );
  }

  async goto() {
    const apiKeysLoaded = this.waitForApiResponse('/v1/auth/api-key/list', 'GET');
    await this.page.goto('/user/developer');
    await apiKeysLoaded;
  }

  async expectLoaded() {
    await expect(this.addApiKeyButton).toBeVisible({ timeout: 10_000 });
  }

  get apiKeyRows() {
    return this.page.getByTestId('api-key-row');
  }

  apiKeyRowByName(name: string) {
    return this.apiKeyRows.filter({ hasText: name });
  }

  async createApiKey(name: string) {
    await this.addApiKeyButton.click();
    await expect(this.createModalNameInput).toBeVisible({ timeout: 5_000 });
    await this.createModalNameInput.fill(name);
    const keyCreated = this.waitForApiResponse('/v1/auth/api-key/create', 'POST');
    await this.createModalSubmit.click();
    await keyCreated;
    await expect(this.keyCreatedAlert).toBeVisible({ timeout: 10_000 });
  }

  async openOptionsMenu(row: Locator) {
    const optionsButton = row.getByTestId('dropdown-toggle');
    await optionsButton.dispatchEvent('click');
  }

  async renameApiKey(row: Locator, newName: string) {
    await this.openOptionsMenu(row);
    await row.locator('a', { hasText: 'Rename' }).dispatchEvent('click');
    await expect(this.renameModalNameInput).toBeVisible({ timeout: 5_000 });
    await this.renameModalNameInput.clear();
    await this.renameModalNameInput.fill(newName);
    const keyRenamed = this.waitForApiResponse('/v1/auth/api-key/update', 'POST');
    await this.renameModalSubmit.click();
    await keyRenamed;
  }

  async deactivateApiKey(row: Locator) {
    await this.openOptionsMenu(row);
    const keyDeactivated = this.waitForApiResponse('/v1/auth/api-key/update', 'POST');
    await row.locator('a', { hasText: 'Deactivate' }).dispatchEvent('click');
    await keyDeactivated;
    await expect(this.keyDeactivatedAlert).toBeVisible({ timeout: 10_000 });
  }
}
