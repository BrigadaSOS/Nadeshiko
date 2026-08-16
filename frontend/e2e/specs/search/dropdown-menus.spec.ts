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
    // English only, and not because the menu lost Spanish: the copy menu offers
    // a row per translation the card actually has, and a signed-out reader in
    // the English locale is served English alone (`defaultTranslationLanguages`).
    // The 'Spanish sentence' row this used to assert needs a reader who has
    // chosen both languages globally -- see segment-card.spec.ts.
    await expect(menu.getByText('English sentence')).toBeVisible();
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

  test('opening one dropdown closes another', async ({ page }) => {
    const card = search.segmentCards.first();
    const copy = card.getByTestId('copy-dropdown');
    const download = card.getByTestId('download-dropdown');

    await copy.getByTestId('dropdown-toggle').click();
    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();

    await download.getByTestId('dropdown-toggle').click();
    await expect(download.getByTestId('dropdown-menu')).toBeVisible();
    await expect(copy.getByTestId('dropdown-menu')).toBeHidden();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(1);
  });

  test('opening a result dropdown closes the visibility menu', async ({ page }) => {
    await search.enToggle.click();
    await expect(search.visibilityOption('en', 'show')).toBeVisible();

    const copy = search.segmentCards.first().getByTestId('copy-dropdown');
    await copy.getByTestId('dropdown-toggle').click();

    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();
    await expect(search.visibilityOption('en', 'show')).toBeHidden();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(1);
  });

  test('opening a result dropdown closes the word card', async ({ page }) => {
    await search.openFirstTokenCard();
    await expect(page.locator('.token-tooltip')).toBeVisible();

    // Another card, so the word card (which hangs off the sentence) cannot
    // sit on top of the button we are about to press.
    const otherCard = search.segmentCards.nth(1);
    await expect(otherCard).toBeVisible();
    const copy = otherCard.getByTestId('copy-dropdown');
    await copy.getByTestId('dropdown-toggle').click();

    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();
    await expect(page.locator('.token-tooltip')).toBeHidden();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(1);
  });

  test('opening the shortcuts modal closes the word card', async ({ page }) => {
    await search.openFirstTokenCard();
    await expect(page.locator('.token-tooltip')).toBeVisible();

    await page.keyboard.press('?');

    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await expect(page.locator('.token-tooltip')).toBeHidden();
  });

  test('opening the shortcuts modal closes an open result dropdown', async ({ page }) => {
    const copy = search.segmentCards.first().getByTestId('copy-dropdown');
    await copy.getByTestId('dropdown-toggle').click();
    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();

    await page.keyboard.press('?');

    await expect(page.getByTestId('shortcuts-modal')).toBeVisible();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(0);
  });

  test('opening a word card closes an open result dropdown', async ({ page }) => {
    const copy = search.segmentCards.first().getByTestId('copy-dropdown');
    await copy.getByTestId('dropdown-toggle').click();
    await expect(copy.getByTestId('dropdown-menu')).toBeVisible();

    await search.openFirstTokenCard();

    await expect(page.locator('.token-tooltip')).toBeVisible();
    await expect(copy.getByTestId('dropdown-menu')).toBeHidden();
    await expect(page.getByTestId('dropdown-menu')).toHaveCount(0);
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
