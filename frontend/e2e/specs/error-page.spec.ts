import { test, expect } from '../fixtures';

test.describe('Error page', () => {
  test('404 shows custom error page with status code', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');

    const statusCode = page.getByTestId('error-status-code');
    await expect(statusCode).toBeVisible({ timeout: 10_000 });
    await expect(statusCode).toHaveText('404');
  });

  test('404 shows "Page Not Found" message', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');

    const message = page.getByText('Page Not Found');
    await expect(message).toBeVisible({ timeout: 10_000 });
  });

  test('404 shows the error illustration', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');

    const image = page.getByTestId('error-image');
    await expect(image).toBeVisible({ timeout: 10_000 });
  });

  test('404 has a "Go Home" link that navigates to homepage', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-at-all');

    const homeLink = page.getByText('Go Home');
    await expect(homeLink).toBeVisible({ timeout: 10_000 });

    await homeLink.click();
    await expect(page).toHaveURL(/\/$/);
  });
});
