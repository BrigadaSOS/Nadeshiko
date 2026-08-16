import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

/**
 * Driven from the Japanese locale, and that is load-bearing rather than
 * incidental.
 *
 * This feature is per-language: half of it is that the EN and ES menus move
 * independently. Since `87619065` a reader is only offered the languages their
 * interface language defaults them to — English alone in `en`, Spanish alone in
 * `es` — so run signed out in `en` there is no ES control to open and no ES
 * badge to assert, and five of these tests were asserting a two-language page
 * that reader never sees.
 *
 * `ja` is the locale that defaults to both (`defaultTranslationLanguages`), so
 * it is the one that exercises the whole feature without an account. Every
 * locator here is a test id, so the Japanese interface changes nothing else.
 */
test.describe('Translation visibility', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女', { locale: 'ja' });
    await search.expectResultsVisible();
  });

  test('EN, ES and furigana buttons are visible', async () => {
    await expect(search.enToggle).toBeVisible();
    await expect(search.esToggle).toBeVisible();
    await expect(search.furiganaToggle).toBeVisible();
  });

  test('translations are visible by default', async () => {
    await expect(search.translationBadges('EN')).toBeVisible();
    await expect(search.translationBadges('ES')).toBeVisible();
  });

  test('EN menu lists shown, on hover, and hidden', async ({ page }) => {
    await search.enToggle.click();
    const menu = page.getByTestId('dropdown-menu');
    await expect(menu).toBeVisible();
    await expect(search.visibilityOption('en', 'show')).toBeVisible();
    await expect(search.visibilityOption('en', 'spoiler')).toBeVisible();
    await expect(search.visibilityOption('en', 'hidden')).toBeVisible();
  });

  test('picking On hover on EN sets spoiler mode', async () => {
    await search.setVisibility('en', 'spoiler');

    const textSpan = search.translationText('EN');
    await expect(textSpan).toHaveClass(/text-transparent/);
  });

  test('picking Hidden on EN hides translations entirely', async () => {
    await search.setVisibility('en', 'hidden');

    await expect(search.translationBadges('EN')).not.toBeVisible();
  });

  test('picking Shown on EN returns to show mode', async () => {
    await search.setVisibility('en', 'hidden');
    await search.setVisibility('en', 'show');

    await expect(search.translationBadges('EN')).toBeVisible();
    const textSpan = search.translationText('EN');
    await expect(textSpan).not.toHaveClass(/text-transparent/);
  });

  test('picking On hover on ES sets spoiler mode', async () => {
    await search.setVisibility('es', 'spoiler');

    const textSpan = search.translationText('ES');
    await expect(textSpan).toHaveClass(/text-transparent/);
  });

  test('picking Hidden on ES hides translations entirely', async () => {
    await search.setVisibility('es', 'hidden');

    await expect(search.translationBadges('ES')).not.toBeVisible();
  });

  test('EN and ES menus are independent', async () => {
    await search.setVisibility('en', 'hidden');

    await expect(search.translationBadges('EN')).not.toBeVisible();
    await expect(search.translationBadges('ES')).toBeVisible();
  });

  test('hidden mode persists after page reload', async ({ page }) => {
    await search.setVisibility('en', 'hidden');
    await expect(search.translationBadges('EN')).not.toBeVisible();

    await search.setVisibility('es', 'hidden');
    await expect(search.translationBadges('ES')).not.toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.expectResultsVisible();

    await expect(search.translationBadges('EN')).not.toBeVisible();
    await expect(search.translationBadges('ES')).not.toBeVisible();
  });

  test('spoiler mode persists after page reload', async ({ page }) => {
    await search.setVisibility('en', 'spoiler');
    const textSpan = search.translationText('EN');
    await expect(textSpan).toHaveClass(/text-transparent/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.expectResultsVisible();

    await expect(search.translationBadges('EN')).toBeVisible();
    await expect(search.translationText('EN')).toHaveClass(/text-transparent/);
  });
});
