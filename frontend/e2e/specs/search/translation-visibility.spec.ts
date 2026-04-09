import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Translation visibility', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

  });

  test('EN and ES toggle buttons are visible', async () => {
    await expect(search.enToggle).toBeVisible();
    await expect(search.esToggle).toBeVisible();
  });

  test('translations are visible by default', async () => {
    await expect(search.translationBadges('EN')).toBeVisible();
    await expect(search.translationBadges('ES')).toBeVisible();
  });

  test('clicking EN once sets spoiler mode', async () => {
    await search.enToggle.click();

    const textSpan = search.translationText('EN');
    await expect(textSpan).toHaveClass(/text-transparent/);
  });

  test('clicking EN twice hides translations entirely', async () => {
    await search.enToggle.click();
    await search.enToggle.click();

    await expect(search.translationBadges('EN')).not.toBeVisible();
  });

  test('clicking EN three times returns to show mode', async () => {
    await search.enToggle.click();
    await search.enToggle.click();
    await search.enToggle.click();

    await expect(search.translationBadges('EN')).toBeVisible();
    const textSpan = search.translationText('EN');
    await expect(textSpan).not.toHaveClass(/text-transparent/);
  });

  test('clicking ES once sets spoiler mode', async () => {
    await search.esToggle.click();

    const textSpan = search.translationText('ES');
    await expect(textSpan).toHaveClass(/text-transparent/);
  });

  test('clicking ES twice hides translations entirely', async () => {
    await search.esToggle.click();
    await search.esToggle.click();

    await expect(search.translationBadges('ES')).not.toBeVisible();
  });

  test('EN and ES toggles are independent', async () => {
    await search.enToggle.click();
    await search.enToggle.click();

    await expect(search.translationBadges('EN')).not.toBeVisible();
    await expect(search.translationBadges('ES')).toBeVisible();
  });

  test('hidden mode persists after page reload', async ({ page }) => {
    await search.enToggle.click();
    await search.enToggle.click();
    await expect(search.translationBadges('EN')).not.toBeVisible();

    await search.esToggle.click();
    await search.esToggle.click();
    await expect(search.translationBadges('ES')).not.toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.expectResultsVisible();

    await expect(search.translationBadges('EN')).not.toBeVisible();
    await expect(search.translationBadges('ES')).not.toBeVisible();
  });

  test('spoiler mode persists after page reload', async ({ page }) => {
    await search.enToggle.click();
    const textSpan = search.translationText('EN');
    await expect(textSpan).toHaveClass(/text-transparent/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await search.expectResultsVisible();

    await expect(search.translationBadges('EN')).toBeVisible();
    await expect(search.translationText('EN')).toHaveClass(/text-transparent/);
  });
});
