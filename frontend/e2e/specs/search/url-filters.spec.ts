import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

async function clickFirstMediaFilter(search: SearchPage) {
  const mediaLink = search.segmentCards.first().getByTestId('segment-media-name');
  await mediaLink.scrollIntoViewIfNeeded();
  const urlChange = search.page.waitForURL((url) => url.searchParams.has('media'), { timeout: 15_000 });
  await mediaLink.click({ force: true });
  await urlChange;

  return new URL(search.page.url()).searchParams.get('media')!;
}

test.describe('Search URL filters', () => {
  test('media filter via URL restricts results to that media', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const mediaLink = search.segmentCards.first().getByTestId('segment-media-name');
    const mediaName = (await mediaLink.textContent())!.trim();
    const mediaId = await clickFirstMediaFilter(search);

    await page.goto(`/search/学校?media=${mediaId}`);
    await search.expectResultsVisible();

    const firstMediaLink = search.segmentCards.first().getByTestId('segment-media-name');
    await expect(firstMediaLink).toContainText(mediaName);
  });

  test('search with query and media filter narrows results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const unfilteredCount = await search.getResultCount();

    await clickFirstMediaFilter(search);

    await search.expectResultsVisible();
    const filteredCount = await search.getResultCount();

    expect(filteredCount).toBeLessThanOrEqual(unfilteredCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('empty search with media filter shows results for that media', async ({ page }) => {
    test.setTimeout(60_000);
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const mediaId = await clickFirstMediaFilter(search);

    await page.goto(`/search?media=${mediaId}`);
    await search.expectResultsVisible();

    const count = await search.getResultCount();
    expect(count).toBeGreaterThan(0);
  });
});
