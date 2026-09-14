import { test, expect } from '../fixtures';

declare global {
  interface Window {
    __e2eCspViolations?: Array<{ blockedURI: string; directive: string }>;
  }
}

test.describe('Deployed application health', () => {
  test('hydrates with its external stylesheets and without CSP violations', async ({ page }) => {
    const pageErrors: string[] = [];
    const assetFailures: Array<{ status: number; url: string }> = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const type = response.request().resourceType();
      const url = new URL(response.url());
      // Cloudflare injects its own challenge bootstrap under `/cdn-cgi/`. It
      // intentionally begins with a redirect and is not a release artifact;
      // counting it made every engine report a broken asset while every Nuxt
      // script and stylesheet loaded successfully.
      const isApplicationAsset = url.origin === new URL(page.url()).origin && !url.pathname.startsWith('/cdn-cgi/');
      if ((type === 'script' || type === 'stylesheet') && isApplicationAsset && !response.ok()) {
        assetFailures.push({ status: response.status(), url: response.url() });
      }
    });
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
    expect(assetFailures).toEqual([]);
  });

  test('serves the expected frontend and healthy backend revisions', async ({ page }) => {
    const expectedSha = process.env.E2E_EXPECTED_SHA;
    test.skip(!expectedSha, 'exact revision verification is a deployed-release check');

    const frontendHealth = await page.request.get('/up');
    const frontendBody = await frontendHealth.json();
    expect(frontendHealth, JSON.stringify(frontendBody)).toBeOK();
    expect(frontendBody).toMatchObject({ status: 'ok', releaseSha: expectedSha });

    const site = new URL(process.env.E2E_BASE_URL || 'http://localhost:3000');
    site.hostname = site.hostname === 'stg.nadeshiko.co' ? 'api-stg.nadeshiko.co' : 'api.nadeshiko.co';
    site.pathname = '/up';
    site.search = '';

    const backendHealth = await page.request.get(site.toString());
    const backendBody = await backendHealth.json();
    expect(backendHealth, JSON.stringify(backendBody)).toBeOK();
    expect(backendBody).toMatchObject({
      status: 'ok',
      database: 'up',
      elasticsearch: 'up',
      releaseSha: expectedSha,
    });
  });
});
