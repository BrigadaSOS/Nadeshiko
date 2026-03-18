import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Search URL filters', () => {
  test('media filter via URL restricts results to that media', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();


    // Get media name and click to filter
    const mediaLink = search.segmentCards.first().locator('p.text-white\\/50 button').first();
    const mediaName = (await mediaLink.textContent())!.trim();
    await mediaLink.click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });

    // Extract the media ID from the URL
    const url = new URL(page.url());
    const mediaId = url.searchParams.get('media')!;

    // Navigate directly with query + media filter
    await page.goto(`/search/学校?media=${mediaId}`);
    await search.expectResultsVisible();

    // All results should be from the same media
    const firstMediaLink = search.segmentCards.first().locator('p.text-white\\/50 button').first();
    await expect(firstMediaLink).toContainText(mediaName);
  });

  test('search with query and media filter narrows results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();


    const unfilteredCount = await search.getResultCount();

    // Click media name to filter
    const mediaLink = search.segmentCards.first().locator('p.text-white\\/50 button').first();
    await mediaLink.click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });

    await search.expectResultsVisible();
    const filteredCount = await search.getResultCount();

    expect(filteredCount).toBeLessThanOrEqual(unfilteredCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('empty search with media filter shows results for that media', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();


    // Get a media ID by clicking the media name
    const mediaLink = search.segmentCards.first().locator('p.text-white\\/50 button').first();
    await mediaLink.click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });

    const url = new URL(page.url());
    const mediaId = url.searchParams.get('media')!;

    // Navigate with only media filter (no query)
    await page.goto(`/search?media=${mediaId}`);
    await search.expectResultsVisible();

    const count = await search.getResultCount();
    expect(count).toBeGreaterThan(0);
  });
});
