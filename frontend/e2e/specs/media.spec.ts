import { test, expect } from '../fixtures';
import { MediaPage } from '../pages/MediaPage';

test.describe('Media catalog', () => {
  test('displays the media grid', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();

    const count = await media.mediaCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a media card navigates to its search results', async ({ page }) => {
    const media = new MediaPage(page);
    await media.goto();
    await media.expectLoaded();

    await media.clickFirstMedia();
    await expect(page).toHaveURL(/\/search\?media=/);
  });
});
