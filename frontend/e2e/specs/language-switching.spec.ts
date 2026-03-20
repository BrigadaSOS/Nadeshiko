import { test, expect } from '../fixtures';

test.describe('Language switching', () => {
  test('switching to Spanish updates UI text', async ({ page }) => {
    await page.goto('/');

    // Open the language dropdown
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();

    // Select Spanish from the dropdown options
    await langSelector.getByTestId('dropdown-menu').getByText('Spanish').click();

    // Verify navbar text changed to Spanish
    await expect(page.locator('header').getByRole('link', { name: 'Acerca de' })).toBeVisible({ timeout: 10_000 });
  });

  test('switching to Japanese updates UI text', async ({ page }) => {
    await page.goto('/');

    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('Japanese').click();

    await expect(page.locator('header').getByRole('button', { name: /Japanese/i })).toBeVisible({ timeout: 10_000 });
  });

  test('language preference persists across navigation', async ({ page }) => {
    await page.goto('/');

    // Switch to Spanish
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('Spanish').click();

    await expect(page.locator('header').getByRole('link', { name: 'Acerca de' })).toBeVisible({ timeout: 10_000 });

    // Navigate to another page
    await page.locator('header').getByRole('link', { name: 'Media', exact: true }).click();
    await expect(page).toHaveURL(/\/media/);

    // Language should still be Spanish
    await expect(page.locator('header').getByRole('button', { name: /Spanish/i })).toBeVisible();
  });

  test('search page buttons update when switching language', async ({ page }) => {
    await page.goto('/search/彼女');

    const card = page.getByTestId('segment-card').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Verify English text
    await expect(card.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Context' })).toBeVisible();

    // Switch to Spanish
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('Spanish', { exact: true }).click();

    // Buttons should update to Spanish
    await expect(card.getByRole('button', { name: 'Copiar' })).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('button', { name: 'Contexto' })).toBeVisible();
  });
});
