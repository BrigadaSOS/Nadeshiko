import { test, expect } from '../auth';
import { DeveloperPage } from '../pages/DeveloperPage';

test.describe('Developer API Keys', () => {
  test('navigates to developer tab', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/user/developer');
    await expect(authenticatedPage).toHaveURL('/user/developer');

    const developer = new DeveloperPage(authenticatedPage);
    await developer.expectLoaded();
  });

  test('creates a new API key', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-create-${Date.now()}`;
    await developer.createApiKey(keyName);
    await expect(developer.apiKeyRowByName(keyName)).toBeVisible({ timeout: 10_000 });
  });

  test('renames an API key', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-rename-${Date.now()}`;
    const renamedName = `e2e-renamed-${Date.now()}`;
    await developer.createApiKey(keyName);
    const row = developer.apiKeyRowByName(keyName);
    await expect(row).toBeVisible({ timeout: 10_000 });

    await developer.renameApiKey(row, renamedName);

    await expect(developer.apiKeyRowByName(renamedName)).toBeVisible({ timeout: 10_000 });
    await expect(developer.apiKeyRowByName(keyName)).not.toBeVisible();
  });

  test('deactivates an API key', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-deactivate-${Date.now()}`;
    await developer.createApiKey(keyName);
    await expect(developer.apiKeyRowByName(keyName)).toBeVisible({ timeout: 10_000 });

    await developer.deactivateApiKey(developer.apiKeyRowByName(keyName));

    await expect(developer.apiKeyRowByName(keyName)).not.toBeVisible({ timeout: 10_000 });
  });

  test('create modal requires a name', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    await developer.addApiKeyButton.click();
    await expect(developer.createModalNameInput).toBeVisible({ timeout: 5_000 });

    await expect(developer.createModalSubmit).toBeDisabled();
  });

  test('create modal can be closed', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    await developer.addApiKeyButton.click();
    await expect(developer.createModalNameInput).toBeVisible({ timeout: 5_000 });

    await developer.createModal.getByRole('button', { name: 'Close' }).click();
    await expect(developer.createModalNameInput).not.toBeVisible({ timeout: 5_000 });
  });
});
