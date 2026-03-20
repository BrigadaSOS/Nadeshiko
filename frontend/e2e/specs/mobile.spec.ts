import { test, expect } from '../fixtures';
import { SearchPage } from '../pages/SearchPage';

test.describe('Mobile viewport', () => {
  test('hamburger menu is visible on mobile', async ({ page }) => {
    await page.goto('/');

    const hamburger = page.getByTestId('hamburger-menu');
    await expect(hamburger).toBeVisible({ timeout: 10_000 });
  });

  test('desktop nav links are hidden on mobile', async ({ page }) => {
    await page.goto('/');

    // The nav container should be hidden by default on mobile
    const navMenu = page.getByTestId('nav-menu');
    await expect(navMenu).not.toBeVisible();
  });

  test('tapping hamburger opens the nav menu', async ({ page }) => {
    await page.goto('/');


    const hamburger = page.getByTestId('hamburger-menu');
    await hamburger.click();

    const navMenu = page.getByTestId('nav-menu');
    await expect(navMenu).toBeVisible({ timeout: 5_000 });

    // Nav links should now be visible
    await expect(navMenu.getByRole('link', { name: 'Media' })).toBeVisible();
    await expect(navMenu.getByRole('link', { name: 'About' })).toBeVisible();
  });

  test('mobile nav links navigate correctly', async ({ page }) => {
    await page.goto('/');


    const hamburger = page.getByTestId('hamburger-menu');
    await hamburger.click();

    const navMenu = page.getByTestId('nav-menu');
    await expect(navMenu).toBeVisible({ timeout: 5_000 });

    await navMenu.getByRole('link', { name: 'Media' }).click();
    await expect(page).toHaveURL(/\/media$/);
  });

  test('search results display in stacked layout', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    // On mobile, segment cards should use flex-col (stacked) layout
    const card = search.segmentCards.first();
    await expect(card).toHaveClass(/flex-col/);
  });

  test('homepage loads and displays core elements', async ({ page }) => {
    await page.goto('/');

    const heading = page.getByRole('heading', { name: 'Nadeshiko', exact: true });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const searchInput = page.getByTestId('search-input');
    await expect(searchInput).toBeVisible();
  });

  test('search input is usable on mobile', async ({ page }) => {
    await page.goto('/');


    const searchInput = page.getByTestId('search-input');
    await searchInput.click();
    await searchInput.fill('学校');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/search\//, { timeout: 10_000 });
  });
});
