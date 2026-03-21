import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Dropdown menus', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

  });

  test('Save dropdown opens and shows items', async ({ page }) => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('download-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(dropdown).toHaveClass(/nd-dropdown-open/);

    const menu = dropdown.getByTestId('dropdown-menu');
    await expect(menu.getByText('Image + Audio')).toBeVisible();
    await expect(menu.getByText('Image', { exact: true })).toBeVisible();
    await expect(menu.getByText('Audio', { exact: true })).toBeVisible();
  });

  test('Copy dropdown opens and shows items', async ({ page }) => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(dropdown).toHaveClass(/nd-dropdown-open/);

    const menu = dropdown.getByTestId('dropdown-menu');
    await expect(menu.getByText('Image + Audio')).toBeVisible();
    await expect(menu.getByText('Image', { exact: true })).toBeVisible();
    await expect(menu.getByText('Audio', { exact: true })).toBeVisible();
    await expect(menu.getByText('Japanese sentence')).toBeVisible();
    await expect(menu.getByText('English sentence')).toBeVisible();
    await expect(menu.getByText('Spanish sentence')).toBeVisible();
  });

  test('More dropdown opens and shows expand options', async ({ page }) => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('more-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(dropdown).toHaveClass(/nd-dropdown-open/);

    const menu = dropdown.getByTestId('dropdown-menu');
    await expect(menu.getByText('Expand (left)')).toBeVisible();
    await expect(menu.getByText('Expand (both)')).toBeVisible();
    await expect(menu.getByText('Expand (right)')).toBeVisible();
  });

  test('clicking outside closes an open dropdown', async ({ page }) => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(dropdown).toHaveClass(/nd-dropdown-open/);

    // Click outside the dropdown
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    await expect(dropdown).not.toHaveClass(/nd-dropdown-open/);
  });

  test('clicking a dropdown item closes the dropdown', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(dropdown).toHaveClass(/nd-dropdown-open/);

    const menu = dropdown.getByTestId('dropdown-menu');
    await menu.getByText('Japanese sentence').click();

    await expect(dropdown).not.toHaveClass(/nd-dropdown-open/);
  });
});
