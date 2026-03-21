import { test as base } from '@playwright/test';

/**
 * Extended test fixture that:
 * 1. Suppresses known modals (e.g. the v2 migration banner)
 * 2. Waits for the Nuxt app root after every navigation without relying on
 *    `networkidle`, which is brittle against slower or long-lived requests.
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
      await page.waitForLoadState('domcontentloaded');
      await page.locator('#__nuxt').waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
      await page.waitForFunction(() => typeof window !== 'undefined' && !!window.NDOverlay, null, {
        timeout: 10_000,
      }).catch(() => {});
      return response;
    };

    await use(page);
  },
});

export { expect } from '@playwright/test';
