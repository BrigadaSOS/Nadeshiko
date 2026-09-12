import { test, expect } from '../fixtures';

const PRIVATE_ROUTES = [
  '/user/settings',
  '/user/sync',
  '/user/collections',
  '/user/activity',
  '/user/media',
  '/user/developer',
  '/user/admin/users',
  '/user/admin/reports',
  '/user/admin/agent-activity',
  '/user/admin/announcement',
] as const;

test.describe('Private route guards', () => {
  for (const route of PRIVATE_ROUTES) {
    test(`${route} redirects an anonymous reader without leaking its page`, async ({ page }) => {
      const response = await page.goto(route);

      expect(response?.status(), `${route} should resolve to a healthy redirect destination`).toBe(200);
      await expect(page).toHaveURL(/\/(?:en|es|ja)\/?$/);
      await expect(page.locator('[data-testid^="account-"]')).toHaveCount(0);
      await expect(page.locator('[data-testid^="admin-"]')).toHaveCount(0);
    });
  }
});
