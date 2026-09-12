import { request } from '@playwright/test';
import { e2eAccountForWorker, loginAsE2EUser, test, expect } from '../auth';
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

  test('uses a full-account key for collections and enforces ownership', async ({ authenticatedPage, browser }) => {
    const developer = new DeveloperPage(authenticatedPage);
    await developer.goto();
    await developer.expectLoaded();

    const keyName = `e2e-collection-key-${Date.now()}`;
    const createdKey = await developer.createApiKey(keyName, 'fullAccount');
    expect(createdKey.scopes).toEqual(
      expect.arrayContaining(['READ_COLLECTIONS', 'CREATE_COLLECTIONS', 'UPDATE_COLLECTIONS', 'DELETE_COLLECTIONS']),
    );

    const api = await request.newContext({
      baseURL: new URL(authenticatedPage.url()).origin,
      extraHTTPHeaders: { ...e2eBypassHeaders(), Authorization: `Bearer ${createdKey.key}` },
    });
    let collectionPublicId: string | undefined;
    const visitor = await browser.newContext({
      baseURL: new URL(authenticatedPage.url()).origin,
      extraHTTPHeaders: e2eBypassHeaders(),
    });

    try {
      const segmentResponse = await authenticatedPage.request.post('/v1/search', {
        data: { query: { search: '私' }, take: 10, include: ['media'] },
      });
      expect(segmentResponse, await segmentResponse.text()).toBeOK();
      const segmentPublicId = (await segmentResponse.json()).segments?.[0]?.publicId as string | undefined;
      expect(segmentPublicId, 'the seeded corpus must provide a segment for API-key collection tests').toBeTruthy();

      const create = await api.post('/v1/collections', {
        data: { name: `e2e-api-collection-${Date.now()}` },
      });
      expect(create, await create.text()).toBeOK();
      collectionPublicId = ((await create.json()) as { publicId: string }).publicId;

      const add = await api.post(`/v1/collections/${collectionPublicId}/segments`, {
        data: { segmentPublicId },
      });
      expect(add.status()).toBe(204);

      const read = await api.get(`/v1/collections/${collectionPublicId}`);
      expect(read, await read.text()).toBeOK();
      expect((await read.json()).segmentCount).toBe(1);

      const search = await api.post(`/v1/collections/${collectionPublicId}/search`, { data: {} });
      expect(search, await search.text()).toBeOK();
      expect((await search.json()).segments.some((segment: { publicId: string }) => segment.publicId === segmentPublicId)).toBeTruthy();

      const stats = await api.get(`/v1/collections/${collectionPublicId}/stats`);
      expect(stats, await stats.text()).toBeOK();
      expect(Array.isArray((await stats.json()).media)).toBeTruthy();

      const visitorPage = await visitor.newPage();
      await loginAsE2EUser(visitorPage, e2eAccountForWorker(8));
      expect((await visitorPage.request.get(`/v1/collections/${collectionPublicId}`)).status()).toBe(403);
      expect((await visitorPage.request.patch(`/v1/collections/${collectionPublicId}`, { data: { name: 'intruder' } })).status()).toBe(403);
      expect((await visitorPage.request.delete(`/v1/collections/${collectionPublicId}`)).status()).toBe(403);

      const publish = await api.patch(`/v1/collections/${collectionPublicId}`, { data: { visibility: 'PUBLIC' } });
      expect(publish, await publish.text()).toBeOK();
      expect((await visitorPage.request.get(`/v1/collections/${collectionPublicId}`)).status()).toBe(200);

      const privatize = await api.patch(`/v1/collections/${collectionPublicId}`, { data: { visibility: 'PRIVATE' } });
      expect(privatize, await privatize.text()).toBeOK();
      expect((await visitorPage.request.get(`/v1/collections/${collectionPublicId}`)).status()).toBe(403);

      await developer.deactivateApiKey(developer.apiKeyRowByName(keyName));
      await expect(developer.apiKeyRowByName(keyName)).not.toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => (await api.get(`/v1/collections/${collectionPublicId}`)).status(), { timeout: 10_000 }).toBe(401);
    } finally {
      await visitor.close();
      await api.dispose();
      if (collectionPublicId) {
        await authenticatedPage.request.delete(`/v1/collections/${collectionPublicId}`).catch(() => {});
      }
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
