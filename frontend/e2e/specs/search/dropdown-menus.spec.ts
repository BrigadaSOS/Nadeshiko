import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

// Open-ness is asserted on the MENU being visible, not on a class on the
// wrapper. DropdownContainer.vue drives the menu with `v-show="isOpen"`, so
// visibility is the actual contract; the wrapper never gains a state class.
// These tests used to expect `nd-dropdown-open`, which came from the plugin the
// container replaced ("Mirrors the old plugin", DropdownContainer.vue) and has
// not existed in the app since — it appeared nowhere outside this file, so the
// suite was asserting against an implementation that was already gone.
// `nd-dropdown` today is only the <Transition> name, whose classes are
// transient enter/leave ones and never a steady state worth matching on.
test.describe('Dropdown menus', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();
  });

  test('Save dropdown opens and shows items', async () => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('download-dropdown');
    const menu = dropdown.getByTestId('dropdown-menu');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(menu).toBeVisible();
    await expect(menu.getByText('Image + Audio')).toBeVisible();
    await expect(menu.getByText('Image', { exact: true })).toBeVisible();
    await expect(menu.getByText('Audio', { exact: true })).toBeVisible();
  });

  test('Copy dropdown opens and shows items', async () => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    const menu = dropdown.getByTestId('dropdown-menu');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(menu).toBeVisible();
    await expect(menu.getByText('Image + Audio')).toBeVisible();
    await expect(menu.getByText('Image', { exact: true })).toBeVisible();
    await expect(menu.getByText('Audio', { exact: true })).toBeVisible();
    await expect(menu.getByText('Japanese sentence', { exact: true })).toBeVisible();
    await expect(menu.getByText('English sentence')).toBeVisible();
    await expect(menu.getByText('Spanish sentence')).toBeVisible();
  });

  test('More dropdown opens and shows expand options', async () => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('more-dropdown');
    const menu = dropdown.getByTestId('dropdown-menu');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(menu).toBeVisible();
    await expect(menu.getByText('Expand (left)')).toBeVisible();
    await expect(menu.getByText('Expand (both)')).toBeVisible();
    await expect(menu.getByText('Expand (right)')).toBeVisible();
  });

  test('clicking outside closes an open dropdown', async ({ page }) => {
    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    const menu = dropdown.getByTestId('dropdown-menu');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(menu).toBeVisible();

    // Click outside the dropdown
    await page.locator('body').click({ position: { x: 0, y: 0 } });

    await expect(menu).toBeHidden();
  });

  test('clicking a dropdown item closes the dropdown', async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    const card = search.segmentCards.first();
    const dropdown = card.getByTestId('copy-dropdown');
    const menu = dropdown.getByTestId('dropdown-menu');
    await dropdown.getByTestId('dropdown-toggle').click();

    await expect(menu).toBeVisible();

    await menu.getByText('Japanese sentence', { exact: true }).click();

    await expect(menu).toBeHidden();
  });
});
