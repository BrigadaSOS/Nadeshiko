import { test, expect } from '../fixtures';

declare global {
  interface Window {
    __e2eCspViolations?: Array<{ blockedURI: string; directive: string }>;
  }
}

test.describe('Deployed application health', () => {
  test('hydrates with its external stylesheets and without CSP violations', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__e2eCspViolations = [];
      window.addEventListener('securitypolicyviolation', (event) => {
        window.__e2eCspViolations?.push({
          blockedURI: event.blockedURI,
          directive: event.effectiveDirective,
        });
      });
    });

    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html[data-hydrated="true"]')).toBeAttached();

    const stylesheetState = await page.locator('link[rel="stylesheet"][href]').evaluateAll((links) =>
      links.map((link) => ({
        href: (link as HTMLLinkElement).href,
        loaded: Boolean((link as HTMLLinkElement).sheet),
      })),
    );
    expect(stylesheetState.length, 'the deployed page should load external CSS').toBeGreaterThan(0);
    expect(stylesheetState.filter((stylesheet) => !stylesheet.loaded), 'every stylesheet should be applied').toEqual([]);
    expect(await page.evaluate(() => window.__e2eCspViolations ?? [])).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
