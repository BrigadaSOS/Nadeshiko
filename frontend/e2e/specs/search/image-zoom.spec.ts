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

    const overlay = page.getByTestId('image-zoom-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    const zoomedImage = overlay.getByTestId('zoomed-image');
    await expect(zoomedImage).toBeVisible();
  });

  test('clicking the backdrop dismisses it', async ({ page }) => {
    const image = search.segmentImages.first();
    await image.click();

    const overlay = page.getByTestId('image-zoom-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    // The dismiss handler is `@click.self` on the BACKDROP, and BaseModal puts
    // the caller's data-testid on the panel — so clicking `image-zoom-overlay`
    // hit the panel (really the image inside it), which closes for an entirely
    // different reason. Target the backdrop, off-centre so the click does not
    // land on the centred panel and get ignored by `.self`.
    const backdrop = page.getByTestId('image-zoom-overlay-backdrop');
    await backdrop.click({ position: { x: 5, y: 5 } });

    await expect(overlay).toBeHidden();
  });

  test('pressing Escape dismisses the overlay', async ({ page }) => {
    const image = search.segmentImages.first();
    await image.click();

    const overlay = page.getByTestId('image-zoom-overlay');
    await expect(overlay).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  });
});
