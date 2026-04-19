import { test, expect } from '../fixtures';

test.describe('Language switching', () => {
  test('switching to Spanish navigates to /es and updates UI text', async ({ page }) => {
    await page.goto('/');

    // Open the language dropdown
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();

    // Select Spanish from the dropdown options
    await langSelector.getByTestId('dropdown-menu').getByText('Español').click();

    // URL should now be the Spanish locale root
    await expect(page).toHaveURL(/\/es/, { timeout: 10_000 });

    // Verify navbar text changed to Spanish
    await expect(page.locator('header').getByRole('link', { name: 'Acerca de' })).toBeVisible({ timeout: 10_000 });
  });

  test('switching to Japanese navigates to /ja and updates UI text', async ({ page }) => {
    await page.goto('/');

    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('日本語').click();

    await expect(page).toHaveURL(/\/ja/, { timeout: 10_000 });
    await expect(page.locator('header').getByRole('button', { name: /日本語/ })).toBeVisible({ timeout: 10_000 });
  });

  test('language prefix persists across navigation', async ({ page }) => {
    await page.goto('/');

    // Switch to Spanish
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('Español').click();

    await expect(page).toHaveURL(/\/es/, { timeout: 10_000 });
    await expect(page.locator('header').getByRole('link', { name: 'Acerca de' })).toBeVisible({ timeout: 10_000 });

    // Navigate to another page via the Spanish-localized nav link
    await page.locator('header').getByRole('link', { name: 'Media', exact: true }).click();
    await expect(page).toHaveURL(/\/es\/media/);

    // Language should still be Spanish
    await expect(page.locator('header').getByRole('button', { name: /Español/ })).toBeVisible();
  });

  test('search page buttons update when switching language', async ({ page }) => {
    await page.goto('/search/彼女');

    const card = page.getByTestId('segment-card').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Verify English text
    await expect(card.getByRole('button', { name: 'Copy' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Context' })).toBeVisible();

    // Switch to Spanish — page navigates to /es/search/彼女
    const langSelector = page.getByTestId('language-selector');
    await langSelector.getByTestId('dropdown-toggle').click();
    await langSelector.getByTestId('dropdown-menu').getByText('Español', { exact: true }).click();

    await expect(page).toHaveURL(/\/es\/search/, { timeout: 10_000 });

    // Buttons should update to Spanish
    const esCard = page.getByTestId('segment-card').first();
    await expect(esCard).toBeVisible({ timeout: 10_000 });
    await expect(esCard.getByRole('button', { name: 'Copiar' })).toBeVisible({ timeout: 10_000 });
    await expect(esCard.getByRole('button', { name: 'Contexto' })).toBeVisible();
  });
});
