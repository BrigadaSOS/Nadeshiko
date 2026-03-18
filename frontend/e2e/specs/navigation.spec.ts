import { test, expect } from '../fixtures';

test.describe('Navigation and basic routes', () => {
  test('homepage returns 200', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
  });

  test('search page returns 200', async ({ page }) => {
    const response = await page.goto('/search');
    expect(response?.status()).toBe(200);
  });

  test('media page returns 200', async ({ page }) => {
    const response = await page.goto('/media');
    expect(response?.status()).toBe(200);
  });

  test('about page returns 200', async ({ page }) => {
    const response = await page.goto('/about');
    expect(response?.status()).toBe(200);
  });

  test('API docs page returns 200', async ({ page }) => {
    const response = await page.goto('/api/v1/docs');
    expect(response?.status()).toBe(200);
  });

  test('unknown route returns 404 page', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 10_000 });
  });
});
