import { test as base } from '@playwright/test';

/**
 * Extended test fixture that waits for the Nuxt app root after every
 * navigation without relying on `networkidle`, which is brittle against
 * slower or long-lived requests.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Wrap page.goto to automatically wait for hydration after navigation
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, { waitUntil: 'domcontentloaded', ...options });
      await page.locator('#__nuxt').waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
      await page.waitForFunction(
        () => {
          if (typeof window === 'undefined' || !window.NDOverlay) return false;
          const nuxt = document.querySelector('#__nuxt') as any;
          const app = nuxt?.__vue_app__;
          if (!app) return false;
          const isHydrating = app.config?.globalProperties?.$nuxt?.isHydrating;
          return isHydrating === false || isHydrating === undefined;
        },
        null,
        { timeout: 15_000 },
      ).catch(() => {});
      return response;
    };

    await use(page);
  },
});

export { expect } from '@playwright/test';
