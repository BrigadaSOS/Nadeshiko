import { e2eAccountForWorker, loginAsE2EUser, test, expect } from '../auth';
import { e2eBypassHeaders, getE2EBaseUrl } from '../env';

const ADMIN_PAGES = ['users', 'reports', 'agent-activity', 'announcement'] as const;

test.describe('Admin authorization', () => {
  for (const pageName of ADMIN_PAGES) {
    test(`a normal account cannot open the ${pageName} page`, async ({ authenticatedPage }) => {
      await authenticatedPage.goto(`/user/admin/${pageName}`);

      await expect(authenticatedPage).toHaveURL(/\/en\/user\/settings$/, { timeout: 15_000 });
      await expect(authenticatedPage.getByTestId('account-username')).toBeVisible();
    });
  }

  test('a normal account receives 403 from every admin API surface', async ({ authenticatedPage }) => {
    for (const [method, path] of [
      ['get', '/v1/admin/users-with-providers'],
      ['get', '/v1/admin/reports'],
      ['get', '/v1/admin/agent-activity'],
      // Reading the site-wide announcement is intentionally public; changing
      // it is the administration boundary this test must protect.
      ['put', '/v1/admin/announcement'],
    ] as const) {
      const response = await authenticatedPage.request[method](path, { data: {} });
      expect(response.status(), `${path} must reject a non-admin account`).toBe(403);
    }
  });

  test('the staging admin can load every administration surface and its live data', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: getE2EBaseUrl(), extraHTTPHeaders: e2eBypassHeaders() });
    const page = await context.newPage();

    try {
      await loginAsE2EUser(page, e2eAccountForWorker(9));
      for (const [path, heading] of [
        ['/user/admin/users', 'Users'],
        ['/user/admin/reports', 'Report Management'],
        ['/user/admin/agent-activity', 'Agent Activity'],
        ['/user/admin/announcement', 'Announcement'],
      ] as const) {
        const response = await page.goto(path);
        expect(response?.status(), `${path} should render for an admin`).toBe(200);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.Vue-Toastification__toast--error')).toHaveCount(0);
      }
    } finally {
      await context.close();
    }
  });
});
