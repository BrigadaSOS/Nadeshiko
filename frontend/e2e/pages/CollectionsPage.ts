import { type Locator, type Page, expect } from '@playwright/test';

export class CollectionsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly createButton: Locator;
  readonly createInput: Locator;
  readonly createSubmit: Locator;
  readonly renameInput: Locator;
  readonly renameSubmit: Locator;
  readonly deleteSubmit: Locator;
  readonly noCollectionsMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Collections' });
    this.createButton = page.getByTestId('create-collection-button');
    this.createInput = page.locator('#nd-create-collection-input');
    this.createSubmit = page.getByTestId('collection-create-submit');
    this.renameInput = page.locator('#nd-rename-input');
    this.renameSubmit = page.getByTestId('collection-rename-submit');
    this.deleteSubmit = page.getByTestId('collection-delete-submit');
    this.noCollectionsMessage = page.getByText('No collections yet.');
  }

  async goto() {
    await this.page.goto('/user/collections');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 10_000 });
  }

  get collectionRows() {
    return this.page.getByTestId('collection-row');
  }

  collectionRowByName(name: string) {
    return this.collectionRows.filter({ hasText: name });
  }

  async createCollection(name: string) {
    await this.createButton.click();
    await expect(this.createInput).toBeVisible({ timeout: 5_000 });
    await this.createInput.fill(name);
    await this.createSubmit.click();
    await expect(this.collectionRowByName(name)).toBeVisible({ timeout: 10_000 });
  }

  async openMenuFor(row: Locator) {
    await row.getByTestId('collection-menu-toggle').dispatchEvent('click');
  }

  async renameCollection(row: Locator, newName: string) {
    await this.openMenuFor(row);
    await row.getByTestId('collection-rename-action').click();
    await expect(this.renameInput).toBeVisible({ timeout: 5_000 });
    await this.renameInput.clear();
    await this.renameInput.fill(newName);
    await this.renameSubmit.click();
    await expect(this.collectionRowByName(newName)).toBeVisible({ timeout: 10_000 });
  }

  async deleteCollection(row: Locator) {
    await this.openMenuFor(row);
    await row.getByTestId('collection-delete-action').click();
    await expect(this.deleteSubmit).toBeVisible({ timeout: 5_000 });
    await this.deleteSubmit.click();
  }
}
