import { request } from '@playwright/test';
import { test, expect } from '../auth';
import { e2eBypassHeaders } from '../env';
import { DeveloperPage } from '../pages/DeveloperPage';

test.describe('Developer API Keys', () => {
  test.describe.configure({ mode: 'serial' });

  test('navigates to developer tab', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/user/developer');
    await expect(authenticatedPage).toHaveURL(/\/[a-z]{2}\/user\/developer$/);

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

  // The whole chain, because the scopes are the point: the modal's default has
  // to survive the request, the server's ceiling check and the stored key, and
  // the only place all four are visible at once is the permissions column.
  test('creates a read-only key by default', async ({ authenticatedPage }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-scopes-${Date.now()}`;
    await developer.createApiKey(keyName);

    const row = developer.apiKeyRowByName(keyName);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('READ_MEDIA');
    await expect(row).not.toContainText('WRITE_PROFILE');
    await expect(row).not.toContainText('DELETE_COLLECTIONS');
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

  test('uses a read-only key, rejects writes, and invalidates it immediately on revocation', async ({
    authenticatedPage,
  }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-live-key-${Date.now()}`;
    const created = await developer.createApiKey(keyName);
    expect(created).toMatchObject({ name: keyName, scopes: ['READ_MEDIA'] });
    expect(created.key).toMatch(/^nade_/);

    // Deliberately use a fresh request context with no session cookie: otherwise
    // the owner's browser session could authorize a broken API key and make the
    // test pass for the wrong credential.
    const api = await request.newContext({
      baseURL: new URL(authenticatedPage.url()).origin,
      extraHTTPHeaders: { ...e2eBypassHeaders(), Authorization: `Bearer ${created.key}` },
    });

    try {
      const read = await api.get('/v1/media?take=1');
      expect(read, await read.text()).toBeOK();

      const forbiddenWrite = await api.post('/v1/media', { data: {} });
      expect(forbiddenWrite.status()).toBe(403);

      await developer.deactivateApiKey(developer.apiKeyRowByName(keyName));
      await expect(developer.apiKeyRowByName(keyName)).not.toBeVisible({ timeout: 10_000 });

      await expect.poll(async () => (await api.get('/v1/media?take=1')).status(), { timeout: 10_000 }).toBe(401);
    } finally {
      await api.dispose();
    }
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
