import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

// Open-ness is asserted on the MENU being visible, not on a class on the
// wrapper. DropdownContainer.vue drives the menu with `v-if="isOpen"`, so a
// closed menu is not in the document at all and visibility is the actual
// contract; the wrapper never gains a state class. `toBeHidden()` remains the
// right assertion for closing -- it passes for a detached element as readily as
// a hidden one.
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

  /**
   * The reason `v-if` replaced `v-show`, asserted rather than remembered.
   *
   * Every card carries four of these, so a results page held ~123 fully-rendered
   * menus for UI nobody had opened -- 3,476 elements, 46% of the served
   * document, paid on every style recalculation and every interaction. Only one
   * dropdown can be open at a time, so the closed ones were pure weight.
   *
   * A regression here is invisible: the page looks and behaves identically and
   * every other test in this file still passes, because `toBeVisible()` and
   * `toBeHidden()` cannot tell "hidden" from "absent". The count is the only
   * signal there is.
   */
  test('closed dropdown menus are not rendered at all', async ({ page }) => {
    await expect(search.segmentCards.first()).toBeVisible();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(0);

    // ...and exactly one exists once something is opened.
    const dropdown = search.segmentCards.first().getByTestId('copy-dropdown');
    await dropdown.getByTestId('dropdown-toggle').click();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(1);
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
