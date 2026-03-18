import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Image zoom', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

  });

  test('clicking a segment image opens fullscreen overlay', async ({ page }) => {
    const image = search.segmentImages.first();
    await image.click();

    const overlay = page.locator('.ampliada');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const zoomedImage = overlay.locator('img');
    await expect(zoomedImage).toBeVisible();
  });

  test('clicking the overlay dismisses it', async ({ page }) => {
    const image = search.segmentImages.first();
    await image.click();

    const overlay = page.locator('.ampliada');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    await overlay.click();
    await expect(overlay).not.toBeVisible();
  });

  test('pressing Escape dismisses the overlay', async ({ page }) => {
    const image = search.segmentImages.first();
    await image.click();

    const overlay = page.locator('.ampliada');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible();
  });
});
