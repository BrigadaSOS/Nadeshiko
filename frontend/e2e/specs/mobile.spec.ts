import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { SearchPage } from '../pages/SearchPage';

async function openMobileNav(page: Page) {
  const hamburger = page.getByTestId('hamburger-menu');
  await expect(hamburger).toBeVisible({ timeout: 10_000 });
  await hamburger.click({ force: true });
  await expect
    .poll(async () => await hamburger.getAttribute('aria-expanded'), {
      timeout: 10_000,
    })
    .toBe('true');
}

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

    await openMobileNav(page);

    const navMenu = page.getByTestId('nav-menu');
    await expect(navMenu).toBeVisible({ timeout: 5_000 });

    // Nav links should now be visible
    await expect(navMenu.getByRole('link', { name: 'Media' })).toBeVisible();
    await expect(navMenu.getByRole('link', { name: 'About' })).toBeVisible();
  });

  test('mobile nav links navigate correctly', async ({ page }) => {
    await page.goto('/');

    await openMobileNav(page);

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
    // Enter, not the button: below `md` the search and simultaneous-search
    // buttons are hidden so the input and its history get the whole bar, and
    // the on-screen keyboard's Go key is what submits.
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/search\//, { timeout: 10_000 });
  });

  test('the search bar buttons give their width to the history on mobile', async ({ page }) => {
    await page.addInitScript((payload) => {
      window.localStorage.setItem('nd-search-recents', payload);
    }, JSON.stringify({ entries: [{ query: '学校', searchedAt: '2026-08-14T09:00:00.000Z', ids: [] }], dismissed: {} }));
    await page.goto('/');

    const searchInput = page.getByTestId('search-input');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('search-button')).toBeHidden();

    // The history is anchored to the input's column, so hiding the buttons is
    // what lets it run the full width of the bar rather than stopping short of
    // where they used to be.
    await searchInput.click();
    const recents = page.getByTestId('search-recents');
    await expect(recents).toBeVisible({ timeout: 10_000 });

    const bar = await searchInput.evaluate((el) => el.closest('.relative.flex')?.getBoundingClientRect().width ?? 0);
    const menu = await recents.evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.abs(menu - bar)).toBeLessThan(2);
  });
});
