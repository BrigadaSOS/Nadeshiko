import { test as base } from '@playwright/test';

// Wait for hydration after navigation, not networkidle: requests may be slow or long-lived.
export const test = base.extend({
  page: async ({ page }, use) => {
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const response = await originalGoto(url, { waitUntil: 'domcontentloaded', ...options });
      // Standalone documents/auth endpoints do not carry Nuxt's hydration marker.
      const pathname = new URL(page.url()).pathname.replace(/\/$/, '');
      if (
        /^(?:\/(?:en|es|ja|zh|zh-hant|id|pt-BR))?\/api$/.test(pathname) ||
        pathname === '/api/v1/docs' ||
        pathname === '/docs/api/index.html' ||
        pathname === '/v1/auth/verify-email'
      ) {
        return response;
      }
      await page.locator('#__nuxt').waitFor({ state: 'attached', timeout: 10_000 });
      // Fail on missing hydration rather than letting later clicks fail on an inert SSR shell.
      await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached', timeout: 30_000 });
      return response;
    };

    await use(page);
  },
});

export { expect } from '@playwright/test';
