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
      // The API reference is a standalone Scalar document, not a Nuxt page.
      // Every other browser-facing route is owned by Nuxt and must hydrate.
      const pathname = new URL(page.url()).pathname.replace(/\/$/, '');
      if (
        /^(?:\/(?:en|es|ja))?\/api$/.test(pathname) ||
        pathname === '/api/v1/docs' ||
        pathname === '/docs/api/index.html'
      ) {
        return response;
      }
      await page.locator('#__nuxt').waitFor({ state: 'attached', timeout: 10_000 });
      // The app owns this public marker. Do not swallow the timeout: continuing
      // from an unhydrated SSR shell turns one useful failure into an arbitrary
      // click/layout failure several steps later.
      await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 15_000 });
      return response;
    };

    await use(page);
  },
});

export { expect } from '@playwright/test';
