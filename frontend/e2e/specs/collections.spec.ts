import { test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';
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

  /**
   * Regression guard for an authorization bypass, not a feature test.
   *
   * Server-side rendering used to sign every backend call with the master API
   * key. That key's account is seeded `role: ADMIN`, and the backend grants
   * admins read on any collection — so a server render of a private collection
   * fetched it and served it at HTTP 200 to whoever asked, while the `/v1` API
   * correctly refused the same anonymous caller.
   *
   * Written against the rendered page rather than the API on purpose: the API
   * was never wrong, and a test that only exercised it would have passed
   * throughout. Both halves matter — the owner must still see the page, or a
   * "fix" that simply breaks collections would look like a pass.
   */
  test('a private collection is not readable by an anonymous visitor', async ({ authenticatedPage, browser }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-private-${Date.now()}`;
    await collections.createCollection(name);

    const listed = await authenticatedPage.request.get('/v1/collections?take=100');
    expect(listed.ok()).toBeTruthy();
    const created = (await listed.json()).collections.find((c: { name: string }) => c.name === name);
    expect(created, 'the collection just created should come back in the owner\'s list').toBeTruthy();
    expect(created.visibility, 'new collections must default to private').toBe('PRIVATE');

    const url = `/en/collection/${created.publicId}`;

    // Positive control: the owner can read it, so a failure below means the
    // access check works rather than that the page is simply broken.
    const asOwner = await authenticatedPage.request.get(url);
    expect(asOwner.status()).toBe(200);
    expect(await asOwner.text()).toContain(name);

    // `storageState: undefined` is the point of the test: no session cookie, and
    // no cookies of any kind.
    // Built by hand, so it does not inherit the config's `use` block: the bypass
    // headers have to be passed explicitly or this request is throttled like any
    // other anonymous one, and a 429 here reads as "not redirected" -- which is
    // exactly how this assertion started failing for the wrong reason.
    const anonymous = await browser.newContext({
      baseURL: getE2EBaseUrl(),
      storageState: undefined,
      extraHTTPHeaders: e2eBypassHeaders(),
    });
    try {
      const asStranger = await anonymous.request.get(url, { maxRedirects: 0 });

      expect(asStranger.status(), 'an anonymous visitor must be redirected away, not served the page').toBe(302);
      expect(await asStranger.text()).not.toContain(name);
    } finally {
      await anonymous.close();
    }
  });
});
