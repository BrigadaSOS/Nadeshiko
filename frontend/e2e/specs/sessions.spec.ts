import { test, expect } from '../auth';
import { SettingsPage } from '../pages/SettingsPage';

test.describe.configure({ mode: 'serial' });

test.describe('Sessions', () => {
  test.beforeAll(async ({ browser }) => {
    // Revoke all e2e-user sessions to prevent the list-sessions response
    // from exceeding the JSON body size limit (~16KB).
    const context = await browser.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3000' });
    const page = await context.newPage();
    const response = await page.request.post('/v1/auth/sign-in/email', {
      headers: { Origin: process.env.BASE_URL || 'http://localhost:3000' },
      data: { email: 'e2e-user@nadeshiko.co', password: process.env.E2E_USER_PASSWORD || '' },
    });
    if (response.ok()) {
      await page.request.post('/v1/auth/revoke-other-sessions', {
        headers: { Origin: process.env.BASE_URL || 'http://localhost:3000' },
      });
      await page.request.post('/v1/auth/sign-out', {
        headers: { Origin: process.env.BASE_URL || 'http://localhost:3000' },
      });
    }
    await context.close();
  });

  test('displays sessions after refresh', async ({ authenticatedPage }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    await expect(settings.sessionsCard).toBeVisible();
    await settings.refreshSessionsButton.click();
    await expect(settings.allSessionRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('displays user agent info for sessions', async ({ authenticatedPage }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    await settings.refreshSessionsButton.click();
    await expect(settings.allSessionRows.first()).toBeVisible({ timeout: 10_000 });

    const firstRow = settings.allSessionRows.first();
    await expect(firstRow).toContainText('Desktop');
  });

  test('refresh button reloads sessions list', async ({ authenticatedPage }) => {
    const settings = new SettingsPage(authenticatedPage);
    await settings.goto();
    await settings.expectLoaded();

    await settings.refreshSessionsButton.click();
    await expect(settings.allSessionRows.first()).toBeVisible({ timeout: 10_000 });

    const countBefore = await settings.allSessionRows.count();
    await settings.refreshSessionsButton.click();
    await expect(settings.allSessionRows).toHaveCount(countBefore, { timeout: 10_000 });
  });
});
