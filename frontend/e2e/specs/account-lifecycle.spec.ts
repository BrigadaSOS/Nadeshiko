import { e2eAccountForWorker, expect, loginAsE2EUser, test } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';
import { SettingsPage } from '../pages/SettingsPage';

test.describe('Account lifecycle', () => {
  test('downloads a complete data export for the signed-in account', async ({ authenticatedPage, e2eAccount }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    const downloadEvent = authenticatedPage.waitForEvent('download');
    await authenticatedPage.getByTestId('account-export').click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('nadeshiko-data-export.json');

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(exported.profile).toMatchObject({ email: e2eAccount.email, username: e2eAccount.username });
    expect(exported).toMatchObject({
      activity: expect.any(Array),
      collections: expect.any(Array),
      reports: expect.any(Array),
      mediaAffinity: expect.any(Array),
      truncated: expect.any(Object),
    });
  });

  test('cancelling account deletion keeps the account and session intact', async ({ authenticatedPage }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    authenticatedPage.once('dialog', (dialog) => dialog.dismiss());
    await authenticatedPage.getByTestId('account-delete').click();

    const session = await authenticatedPage.request.get('/v1/auth/get-session');
    expect(session).toBeOK();
    expect(await session.json()).toMatchObject({ user: expect.any(Object), session: expect.any(Object) });
  });

  test('logout invalidates the current session and returns home', async ({ browser, e2eAccount }) => {
    // A fresh login is essential: authenticatedPage copies the worker-scoped
    // storage state, and revoking that token would break every later test that
    // the same worker runs with the same saved cookie.
    const context = await browser.newContext({ baseURL: getE2EBaseUrl(), extraHTTPHeaders: e2eBypassHeaders() });
    const page = await context.newPage();
    try {
      await loginAsE2EUser(page, e2eAccount);
      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.expectLoaded();

      await settings.logoutButton.click();
      await expect(page).toHaveURL(/\/(?:en|es|ja)\/?$/, { timeout: 10_000 });

      const session = await page.request.get('/v1/auth/get-session');
      expect(session.status()).toBe(200);
      expect(await session.json()).toBeNull();
    } finally {
      await context.close();
    }
  });
});

test.describe('Destructive account lifecycle', () => {
  test.describe.configure({ retries: 0 });

  test('revokes another device, then deletes a freshly authenticated disposable account', async ({ browser }) => {
    test.info().annotations.push({ type: 'destructive', description: 'staging account 10; recreated by db:prepare' });
    const account = e2eAccountForWorker(10);
    const contextOptions = { baseURL: getE2EBaseUrl(), extraHTTPHeaders: e2eBypassHeaders() };
    const primary = await browser.newContext(contextOptions);
    const otherDevice = await browser.newContext(contextOptions);
    const primaryPage = await primary.newPage();
    const otherPage = await otherDevice.newPage();

    try {
      await loginAsE2EUser(primaryPage, account);
      await loginAsE2EUser(otherPage, account);

      const revoked = await primaryPage.request.post('/v1/auth/revoke-other-sessions', {
        headers: { Origin: getE2EBaseUrl() },
      });
      expect(revoked, await revoked.text()).toBeOK();
      await expect
        .poll(async () => await (await otherPage.request.get('/v1/auth/get-session')).json(), { timeout: 10_000 })
        .toBeNull();

      await primaryPage.goto('/user/settings');
      await expect(primaryPage.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
      await expect(primaryPage.getByTestId('account-email')).toHaveText(account.email);
      primaryPage.once('dialog', (dialog) => dialog.accept());
      const deletionResponse = primaryPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/auth/delete-user' && response.request().method() === 'POST',
      );
      await primaryPage.getByTestId('account-delete').click();
      const deleted = await deletionResponse;
      // `waitForResponse` returns a browser Response, not an APIResponse; its
      // body can also disappear as the successful deletion navigates home.
      expect(deleted.ok(), `account deletion returned HTTP ${deleted.status()}`).toBe(true);
      await expect(primaryPage).toHaveURL(/\/(?:en|es|ja)\/?$/, { timeout: 15_000 });

      const deletedLogin = await primaryPage.request.post('/v1/auth/sign-in/email', {
        headers: { Origin: getE2EBaseUrl() },
        data: { email: account.email, password: process.env.E2E_USER_PASSWORD },
      });
      expect(deletedLogin.status()).toBe(401);
    } finally {
      await primary.close();
      await otherDevice.close();
    }
  });
});
