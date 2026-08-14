import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';

/**
 * Narrowing a search by title or episode, from inside a result card.
 *
 * Every assertion here checks BOTH halves of the destination, because the
 * regression these tests exist for only broke one of them: the filter links
 * were built as `/search?media=X`, which kept the filter and threw the word
 * away. That URL renders a real page -- every sentence in that title -- so the
 * suite stayed green while a search turned into a browse under the reader.
 * A filter is a narrower search, never a different one.
 */
test.describe('Media filter', () => {
  test('clicking media name keeps the query and filters by that media', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const mediaLink = search.segmentCards.first().getByTestId('segment-media-name');
    const mediaName = (await mediaLink.textContent())!.trim();
    await mediaLink.click();

    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    expect(search.searchedWord()).toBe(QUERY);
    await expect(search.searchInput).toHaveValue(QUERY);

    await search.expectResultsVisible();
    // Both halves again, now in the results rather than the URL: the title is
    // the one that was clicked, and the sentences are still about the word.
    await expect(search.segmentCards.first().getByTestId('segment-media-name')).toContainText(mediaName);
    await expect(search.segmentCards.first().getByTestId('segment-japanese-text')).toContainText(QUERY);
  });

  test('clicking an episode keeps the query and adds the episode', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    // Skipped rather than failed when the results happen to be all movies or
    // YouTube clips: neither has an episode to click, and which titles a search
    // returns is not this spec's to pin down.
    const episodeLink = search.episodeLinks.first();
    if (!(await episodeLink.isVisible().catch(() => false))) {
      test.skip(true, `no episode link among the results for ${QUERY}`);
    }

    const episodeLabel = (await episodeLink.textContent())!.trim();
    await episodeLink.click();

    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    await expect(page).toHaveURL(/episode=/, { timeout: 10_000 });
    expect(search.searchedWord()).toBe(QUERY);
    await expect(search.searchInput).toHaveValue(QUERY);

    await search.expectResultsVisible();
    await expect(search.episodeLinks.first()).toHaveText(episodeLabel);
    await expect(search.segmentCards.first().getByTestId('segment-japanese-text')).toContainText(QUERY);
  });

  // The other direction, and the reason `searchedWord()` returns null instead of
  // throwing: reaching a title from outside a search (the home grid, the media
  // index) has no word to keep, and must stay the plain browse it has always been.
  test('a media filter with no search behind it stays a browse', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await search.segmentCards.first().getByTestId('segment-media-name').click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    const mediaId = new URL(page.url()).searchParams.get('media')!;

    await page.goto(`/search?media=${mediaId}`);
    await search.expectResultsVisible();

    expect(search.searchedWord()).toBeNull();
    expect(await search.getResultCount()).toBeGreaterThan(0);
  });
});
