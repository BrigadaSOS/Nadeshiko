import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Media filter', () => {
  test('clicking media name filters results by that media', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();


    const mediaLink = search.segmentCards.first().getByTestId('segment-media-name');
    await mediaLink.click();

    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    await search.expectResultsVisible();
  });
});
