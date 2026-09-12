import { test, expect } from '../auth';

const ADMIN_PAGES = ['users', 'reports', 'agent-activity', 'announcement'] as const;

test.describe('Admin authorization', () => {
  for (const pageName of ADMIN_PAGES) {
    test(`a normal account cannot open the ${pageName} page`, async ({ authenticatedPage }) => {
      await authenticatedPage.goto(`/user/admin/${pageName}`);

      await expect(authenticatedPage).toHaveURL(/\/en\/user\/settings$/, { timeout: 15_000 });
      await expect(authenticatedPage.getByTestId('account-username')).toBeVisible();
    });
  }
});
