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
    // No network wait here, deliberately. This page renders its key list on the
    // SERVER -- `/v1/auth/api-key/list` is off the public allowlist, so the SSR
    // client sends the reader's session cookie and the keys that come back are
    // theirs. Waiting for a browser-side GET meant waiting for a request that
    // no longer happens on first load, and the test timed out after 15s while
    // the page beside it was rendering perfectly.
    //
    // The mutation helpers below still wait on their POSTs, which DO happen in
    // the browser. `expectLoaded()` is what asserts the page arrived.
    await this.page.goto('/user/developer');
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

  /**
   * Creates a key, read-only unless told otherwise.
   *
   * The endpoint is `/v1/user/api-keys`, NOT better-auth's
   * `/v1/auth/api-key/create` this used to wait on: better-auth refuses a
   * client-supplied scope list, so choosing scopes needs a route of our own.
   */
  async createApiKey(name: string, preset: 'readOnly' | 'fullAccount' | 'custom' = 'readOnly') {
    await this.addApiKeyButton.click();
    await expect(this.createModalNameInput).toBeVisible({ timeout: 5_000 });
    await this.createModalNameInput.fill(name);
    if (preset !== 'readOnly') {
      await this.page.getByTestId(`create-apikey-preset-${preset}`).check();
    }
    const keyCreated = this.waitForApiResponse('/v1/user/api-keys', 'POST');
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
    await this.page.getByTestId('dropdown-menu').getByRole('button', { name: 'Rename' }).dispatchEvent('click');
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
    await this.page.getByTestId('dropdown-menu').getByRole('button', { name: 'Deactivate' }).dispatchEvent('click');
    await keyDeactivated;
    await expect(this.keyDeactivatedAlert).toBeVisible({ timeout: 10_000 });
  }
}
