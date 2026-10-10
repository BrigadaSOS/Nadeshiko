import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

for (const [locale, title, message] of [
  ['en', 'Invalid search request', 'Check your search expression and filters, then search again.'],
  ['es', 'Solicitud de búsqueda no válida', 'Revisa la expresión de búsqueda y los filtros y vuelve a buscar.'],
] as const) {
  test(`preserves a translated ${locale} request error from SSR through hydration`, async ({ page }) => {
    const clientSearchRequests: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/v1/search')) clientSearchRequests.push(request.url());
    });

    // An invalid sort is rejected before searching, so this needs no corpus fixture.
    const response = await page.goto(`/${locale}/search/test?sort=NOT_A_SORT`);
    expect(response?.status()).toBe(200);
    const html = await response!.text();
    expect(html).toContain(title);
    expect(html).not.toContain('VALIDATION_FAILED');

    const notice = page.getByTestId('search-failure-notice');
    await expect(notice).toContainText(title);
    await expect(notice).toContainText(message);
    await expect(notice.locator('img')).toHaveAttribute('src', '/assets/no-results.gif');
    await expect(notice.locator('img')).toBeVisible();
    await expect(notice.locator('a[href*="patreon.com"]')).toBeVisible();
    await expect(notice.getByRole('button')).toHaveCount(0);
    expect(clientSearchRequests).toHaveLength(0);
  });
}

test('never displays a raw API error after a client-side search', async ({ page }) => {
  await page.goto('/en/search');
  await page.route(
    (url) => url.pathname.endsWith('/v1/search'),
    (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'INVALID_REQUEST',
          title: 'private-service-hostname',
          detail: 'SQL secret-token <script>alert(1)</script>',
          errors: { query: 'sensitive-field-error' },
        }),
      }),
  );

  await new SearchPage(page).search('request-error-test');
  const notice = page.getByTestId('search-failure-notice');
  await expect(notice).toContainText('Invalid search request');
  await expect(notice.getByRole('button')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('secret-token');
  await expect(page.locator('body')).not.toContainText('private-service-hostname');
  await expect(page.locator('body')).not.toContainText('sensitive-field-error');
});

test('shows a stats-only failure instead of zero-count category tabs', async ({ page }) => {
  await page.goto('/en/search');
  await page.route(
    (url) => url.pathname.endsWith('/v1/search/stats'),
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INTERNAL_SERVER_ERROR', detail: 'private-statistics-hostname' }),
      }),
  );

  await new SearchPage(page).search('stats-error-test');
  await expect(page.getByTestId('search-stats-error')).toBeVisible();
  await expect(page.getByTestId('search-failure-notice')).toContainText(
    'We could not load the search data. Please try again.',
  );
  await expect(page.getByTestId('search-category-tab-all')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('private-statistics-hostname');
});

test('missing content reuses the exact no-results view and keeps Patreon', async ({ page }) => {
  await page.goto('/en/search');
  await page.route(
    (url) => url.pathname.endsWith('/v1/search'),
    (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'NOT_FOUND' }),
      }),
  );
  await new SearchPage(page).search('missing-preview');
  const view = page.getByTestId('search-failure-notice');
  await expect(view.locator('h1')).toHaveText('No results found...');
  await expect(view.locator('img')).toHaveAttribute('src', '/assets/no-results.gif');
  await expect(view.locator('a[href*="immersionkit.com"]')).toBeVisible();
  await expect(view.locator('a[href*="patreon.com"]')).toBeVisible();
  await expect(view).not.toContainText('Content not found');
  await expect(view).not.toContainText('Something went wrong');
});
