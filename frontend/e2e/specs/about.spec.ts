import { test, expect } from '../fixtures';

test.describe('About page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about');
  });

  test('displays the About heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'About' });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('displays the Credits and Data Sources section', async ({ page }) => {
    const section = page.getByRole('heading', { name: 'Credits and Data Sources' });
    await expect(section).toBeVisible();
  });

  test('displays the Contact section', async ({ page }) => {
    const section = page.getByRole('heading', { name: 'Contact' });
    await expect(section).toBeVisible();
  });
});
