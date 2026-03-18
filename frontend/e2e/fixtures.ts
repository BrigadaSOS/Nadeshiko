import { test as base } from '@playwright/test';

/**
 * Extended test fixture that suppresses known modals (e.g. the v2 migration banner)
 * by setting localStorage before page scripts run.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('banner-v2-migration-dismissed', 'true');
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
