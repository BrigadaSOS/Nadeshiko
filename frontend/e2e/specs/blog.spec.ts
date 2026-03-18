import { test, expect } from '../fixtures';

test.describe('Blog', () => {
  test('loads and displays the blog heading', async ({ page }) => {
    await page.goto('/blog');

    const heading = page.getByRole('heading', { name: 'Blog' });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('displays blog posts or empty state', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');

    const emptyState = page.getByText('No blog posts available yet');
    const postLink = page.locator('a[href^="/blog/"]');
    await expect(postLink.first().or(emptyState)).toBeVisible({ timeout: 10_000 });
  });
});
