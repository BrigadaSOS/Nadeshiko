import { test, expect } from '../fixtures';

test.describe('About page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/about');
  });

  test('displays the About heading', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'About' });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('displays the Contribution and Attribution section', async ({ page }) => {
    const section = page.getByRole('heading', { name: 'Contribution and Attribution' });
    await expect(section).toBeVisible({ timeout: 10_000 });
  });

  test('displays contributor cards', async ({ page }) => {
    const contributorsGrid = page.getByTestId('contributors-grid');
    await expect(contributorsGrid).toBeVisible({ timeout: 10_000 });

    const cards = contributorsGrid.getByTestId('contributor-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
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
