import { e2eAccountForWorker, loginAsE2EUser, test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';
import { CollectionsPage } from '../pages/CollectionsPage';

type Collection = {
  publicId: string;
  name: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  segmentCount: number;
};

async function collectionByName(page: import('@playwright/test').Page, name: string): Promise<Collection> {
  const response = await page.request.get('/v1/collections?take=100');
  expect(response, await response.text()).toBeOK();
  const collection = (await response.json()).collections.find((item: Collection) => item.name === name);
  expect(collection, `collection ${name} should exist in the owner's list`).toBeTruthy();
  return collection as Collection;
}

async function searchSegment(page: import('@playwright/test').Page): Promise<string> {
  const response = await page.request.post('/v1/search', {
    data: { query: { search: '私' }, take: 10, include: ['media'] },
  });
  expect(response, await response.text()).toBeOK();
  const { segments } = await response.json();
  expect(segments?.[0]?.publicId, 'the seeded corpus must provide a segment for collection tests').toBeTruthy();
  return segments[0].publicId;
}

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

  test('opening the profile menu closes a collection row menu', async ({ authenticatedPage }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-menu-${Date.now()}`;
    await collections.createCollection(name);

    const row = collections.collectionRowByName(name);
    await collections.openMenuFor(row);
    await expect(authenticatedPage.getByTestId('collection-rename-action')).toBeVisible();

    await authenticatedPage.getByTestId('profile-dropdown').getByTestId('dropdown-toggle').click();

    await expect(authenticatedPage.getByTestId('profile-dropdown').getByTestId('dropdown-menu')).toBeVisible();
    await expect(authenticatedPage.getByTestId('collection-rename-action')).toBeHidden();
    await expect(authenticatedPage.getByTestId('dropdown-menu')).toHaveCount(1);
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

  test('a public collection is readable by another signed-in account', async ({
    authenticatedPage,
    browser,
    e2eAccount,
  }) => {
    const name = `e2e-public-${Date.now()}`;
    const createdResponse = await authenticatedPage.request.post('/v1/collections', {
      data: { name, visibility: 'PUBLIC' },
    });
    expect(createdResponse, await createdResponse.text()).toBeOK();
    const created = (await createdResponse.json()) as { publicId: string };

    const visitor = await browser.newContext({
      baseURL: getE2EBaseUrl(),
      extraHTTPHeaders: e2eBypassHeaders(),
    });
    try {
      const visitorPage = await visitor.newPage();
      // Account 8 is seeded only for cross-account checks. Worker accounts are
      // deliberately excluded so this login/session cannot race a stateful
      // settings or session-management test running in parallel.
      await loginAsE2EUser(visitorPage, e2eAccountForWorker(8));

      const response = await visitorPage.goto(`/en/collection/${created.publicId}`);
      expect(response?.status()).toBe(200);
      await expect(visitorPage.getByRole('heading', { name })).toBeAttached();
      await expect(visitorPage.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 15_000 });
    } finally {
      await visitor.close();
      await authenticatedPage.request.delete(`/v1/collections/${created.publicId}`).catch(() => {});
    }
  });

  test('owner can publish and revoke collection access from the UI', async ({ authenticatedPage, browser }) => {
    const collections = new CollectionsPage(authenticatedPage);
    await collections.goto();
    await collections.expectLoaded();

    const name = `e2e-visibility-${Date.now()}`;
    await collections.createCollection(name);
    const created = await collectionByName(authenticatedPage, name);
    const row = collections.collectionRowByName(name);
    const visitor = await browser.newContext({
      baseURL: getE2EBaseUrl(),
      extraHTTPHeaders: e2eBypassHeaders(),
    });

    try {
      const visitorPage = await visitor.newPage();
      await loginAsE2EUser(visitorPage, e2eAccountForWorker(8));

      await collections.openMenuFor(row);
      await authenticatedPage.getByTestId('collection-visibility-action').click();
      await authenticatedPage.getByTestId('collection-visibility-submit').click();
      await expect.poll(async () => (await authenticatedPage.request.get(`/v1/collections/${created.publicId}`)).json().then((item) => item.visibility)).toBe('PUBLIC');

      // Public means readable by another signed-in account. Collection routes
      // intentionally require authentication even when their visibility is
      // PUBLIC; the existing anonymous redirect is part of the privacy model.
      const publicResponse = await visitorPage.request.get(`/v1/collections/${created.publicId}`);
      expect(publicResponse, await publicResponse.text()).toBeOK();
      expect((await publicResponse.json()).name).toBe(name);

      await collections.openMenuFor(row);
      await authenticatedPage.getByTestId('collection-visibility-action').click();
      await authenticatedPage.getByTestId('collection-visibility-submit').click();
      await expect.poll(async () => (await authenticatedPage.request.get(`/v1/collections/${created.publicId}`)).json().then((item) => item.visibility)).toBe('PRIVATE');

      const revokedResponse = await visitorPage.request.get(`/v1/collections/${created.publicId}`);
      expect(revokedResponse.status(), 'making a public collection private must revoke visitor access').toBe(403);
    } finally {
      await visitor.close();
      await authenticatedPage.request.delete(`/v1/collections/${created.publicId}`).catch(() => {});
    }
  });

  test('collection contents and counts enforce owner-only mutations and readable visibility', async ({
    authenticatedPage,
    browser,
  }) => {
    const name = `e2e-authorization-${Date.now()}`;
    const create = await authenticatedPage.request.post('/v1/collections', { data: { name } });
    expect(create, await create.text()).toBeOK();
    const created = (await create.json()) as Collection;
    const segmentPublicId = await searchSegment(authenticatedPage);

    const visitor = await browser.newContext({
      baseURL: getE2EBaseUrl(),
      extraHTTPHeaders: e2eBypassHeaders(),
    });
    try {
      const visitorPage = await visitor.newPage();
      await loginAsE2EUser(visitorPage, e2eAccountForWorker(8));

      const add = await authenticatedPage.request.post(`/v1/collections/${created.publicId}/segments`, {
        data: { segmentPublicId },
      });
      expect(add.status()).toBe(204);

      const ownerCollection = await authenticatedPage.request.get(`/v1/collections/${created.publicId}`);
      expect(ownerCollection, await ownerCollection.text()).toBeOK();
      expect((await ownerCollection.json()).segmentCount).toBe(1);

      const search = await authenticatedPage.request.post(`/v1/collections/${created.publicId}/search`, {
        data: { take: 10, include: ['media'] },
      });
      expect(search, await search.text()).toBeOK();
      expect((await search.json()).segments.some((segment: { publicId: string }) => segment.publicId === segmentPublicId)).toBeTruthy();

      const stats = await authenticatedPage.request.get(`/v1/collections/${created.publicId}/stats`);
      expect(stats, await stats.text()).toBeOK();
      const statsBody = await stats.json();
      expect(Array.isArray(statsBody.media)).toBeTruthy();
      expect(Array.isArray(statsBody.categories)).toBeTruthy();

      const remove = await authenticatedPage.request.delete(
        `/v1/collections/${created.publicId}/segments/${segmentPublicId}`,
      );
      expect(remove.status()).toBe(204);
      const emptyCollection = await authenticatedPage.request.get(`/v1/collections/${created.publicId}`);
      expect(emptyCollection, await emptyCollection.text()).toBeOK();
      expect((await emptyCollection.json()).segmentCount).toBe(0);
      const emptySearch = await authenticatedPage.request.post(`/v1/collections/${created.publicId}/search`, {
        data: { take: 10 },
      });
      expect(emptySearch, await emptySearch.text()).toBeOK();
      expect((await emptySearch.json()).segments).toHaveLength(0);

      // Put it back so the cross-account PATCH/DELETE-segment checks below
      // exercise an existing member rather than a missing-resource response.
      const reAdd = await authenticatedPage.request.post(`/v1/collections/${created.publicId}/segments`, {
        data: { segmentPublicId },
      });
      expect(reAdd.status()).toBe(204);

      // A private collection is not a mutation oracle for another account: all
      // reads and every owner-only write must be refused consistently.
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}`)).status()).toBe(403);
      expect((await visitorPage.request.post(`/v1/collections/${created.publicId}/search`, { data: {} })).status()).toBe(403);
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}/stats`)).status()).toBe(403);
      expect((await visitorPage.request.patch(`/v1/collections/${created.publicId}`, { data: { name: 'intruder' } })).status()).toBe(403);
      expect((await visitorPage.request.post(`/v1/collections/${created.publicId}/segments`, { data: { segmentPublicId } })).status()).toBe(403);
      expect((await visitorPage.request.patch(`/v1/collections/${created.publicId}/segments/${segmentPublicId}`, { data: { position: 2 } })).status()).toBe(403);
      expect((await visitorPage.request.delete(`/v1/collections/${created.publicId}/segments/${segmentPublicId}`)).status()).toBe(403);
      expect((await visitorPage.request.delete(`/v1/collections/${created.publicId}`)).status()).toBe(403);

      const publish = await authenticatedPage.request.patch(`/v1/collections/${created.publicId}`, {
        data: { visibility: 'PUBLIC' },
      });
      expect(publish, await publish.text()).toBeOK();
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}`)).status()).toBe(200);
      expect((await visitorPage.request.post(`/v1/collections/${created.publicId}/search`, { data: {} })).status()).toBe(200);
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}/stats`)).status()).toBe(200);

      const privatize = await authenticatedPage.request.patch(`/v1/collections/${created.publicId}`, {
        data: { visibility: 'PRIVATE' },
      });
      expect(privatize, await privatize.text()).toBeOK();
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}`)).status()).toBe(403);
      expect((await visitorPage.request.post(`/v1/collections/${created.publicId}/search`, { data: {} })).status()).toBe(403);
      expect((await visitorPage.request.get(`/v1/collections/${created.publicId}/stats`)).status()).toBe(403);
    } finally {
      await visitor.close();
      await authenticatedPage.request.delete(`/v1/collections/${created.publicId}`).catch(() => {});
    }
  });
});
