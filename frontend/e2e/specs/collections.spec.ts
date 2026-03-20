import { test, expect } from '../auth';
import { CollectionsPage } from '../pages/CollectionsPage';

test.describe('Collections', () => {
  test('displays collections page', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    await expect(collections.createButton).toBeVisible();
  });

  test('creates a new collection', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-collection-${Date.now()}`;
    await collections.createCollection(name);

    await expect(collections.collectionRowByName(name)).toBeVisible();
  });

  test('renames a collection', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-rename-src-${Date.now()}`;
    const newName = `e2e-rename-dst-${Date.now()}`;
    await collections.createCollection(name);

    const row = collections.collectionRowByName(name);
    await collections.renameCollection(row, newName);

    await expect(collections.collectionRowByName(newName)).toBeVisible();
    await expect(collections.collectionRowByName(name)).not.toBeVisible();
  });

  test('deletes a collection', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-delete-${Date.now()}`;
    await collections.createCollection(name);
    await expect(collections.collectionRowByName(name)).toBeVisible();

    const row = collections.collectionRowByName(name);
    await collections.deleteCollection(row);

    await expect(collections.collectionRowByName(name)).not.toBeVisible({ timeout: 10_000 });
  });

  test('create modal can be dismissed', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    await collections.createButton.click();
    await expect(collections.createInput).toBeVisible({ timeout: 5_000 });

    await authenticatedPage.keyboard.press('Escape');
    await expect(collections.createInput).not.toBeVisible({ timeout: 5_000 });
  });
});
