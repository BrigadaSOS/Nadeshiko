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

    const stylesheets = page.locator('link[rel="stylesheet"][href]');
    expect(await stylesheets.count(), 'the deployed page should load external CSS').toBeGreaterThan(0);
    // Hydration can finish while route-level CSS is still downloading. Poll
    // the live set: an immediate snapshot consistently raced those final files
    // on CI even though they returned 200 and were applied milliseconds later.
    await expect
      .poll(
        () =>
          stylesheets.evaluateAll((links) =>
            links
              .filter((link) => !Boolean((link as HTMLLinkElement).sheet))
              .map((link) => (link as HTMLLinkElement).href),
          ),
        { message: 'every stylesheet should be applied' },
      )
      .toEqual([]);
    expect(await page.evaluate(() => window.__e2eCspViolations ?? [])).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
