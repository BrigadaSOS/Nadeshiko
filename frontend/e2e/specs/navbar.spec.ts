import { test, expect } from '../fixtures';

test.describe('Navbar links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('Media link navigates to /media', async ({ page }) => {
    await page.getByRole('link', { name: 'Media', exact: true }).click();
    await expect(page).toHaveURL(/\/media$/);
  });

  test('Blog link navigates to /blog', async ({ page }) => {
    await page.getByRole('link', { name: 'Blog', exact: true }).click();
    await expect(page).toHaveURL(/\/blog$/);
  });

  test('About link navigates to /about', async ({ page }) => {
    await page.locator('header').getByRole('link', { name: 'About', exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
  });

  test('API link navigates to docs', async ({ page }) => {
    await page.locator('header').getByRole('link', { name: 'API', exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/api/);
  });

  test('logo navigates to homepage', async ({ page }) => {
    await page.goto('/about');
    await page.getByRole('link', { name: 'Nadeshiko' }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });
});
