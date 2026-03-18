import { test as base } from '@playwright/test';

/**
 * Extended test fixture that:
 * 1. Suppresses known modals (e.g. the v2 migration banner)
 * 2. Waits for Nuxt hydration after every navigation by auto-appending
 *    a `networkidle` wait after each `page.goto()` call.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('banner-v2-migration-dismissed', 'true');
    });

    // Wrap page.goto to automatically wait for hydration after navigation
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, options);
      await page.waitForLoadState('networkidle');
      return response;
    };

    await use(page);
  },
});

export { expect } from '@playwright/test';
