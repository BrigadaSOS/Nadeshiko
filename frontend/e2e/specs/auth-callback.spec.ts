import { test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';

test.describe('Authentication callback', () => {
  test('an authenticated callback returns to the page saved before sign-in', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.evaluate(() => {
      sessionStorage.setItem(
        'nd-auth-return-to',
        JSON.stringify({ path: '/en/user/settings', createdAt: Date.now() }),
      );
    });

    await authenticatedPage.goto('/auth/callback?nd_auth=1');

    await expect(authenticatedPage).toHaveURL(/\/en\/user\/settings$/, { timeout: 15_000 });
    await expect(authenticatedPage.getByTestId('account-username')).toBeVisible();
    expect(await authenticatedPage.evaluate(() => sessionStorage.getItem('nd-auth-return-to'))).toBeNull();
  });

  test('a rejected provider callback clears its query and leaves the callback page', async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: getE2EBaseUrl(),
      extraHTTPHeaders: e2eBypassHeaders(),
    });
    try {
      const page = await context.newPage();
      await page.goto('/auth/callback?error=access_denied');

      await expect(page).toHaveURL(/\/en\/?$/, { timeout: 15_000 });
      expect(new URL(page.url()).search).toBe('');
    } finally {
      await context.close();
    }
  });
});
