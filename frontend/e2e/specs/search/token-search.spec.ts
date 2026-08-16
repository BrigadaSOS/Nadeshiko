import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';

/**
 * Searching a word picked out of a sentence.
 *
 * The property under test is that this agrees with typing the same word into the
 * box: both are "search for this word", and the scope the reader is standing in
 * belongs to them either way. It did not agree -- the box kept the filters and
 * the click threw them away -- which meant reading inside one show and tapping a
 * word silently dropped the reader out of it.
 */
test.describe('Searching a word from a sentence', () => {
  test('keeps the title the reader is filtered to', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await search.segmentCards.first().getByTestId('segment-media-name').click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    const mediaId = new URL(page.url()).searchParams.get('media');
    await search.expectResultsVisible();

    const headword = await search.openFirstTokenCard({ excluding: QUERY });
    await search.tokenCardSearch.click();

    await expect.poll(() => search.searchedWord(), { timeout: 10_000 }).toBe(headword);
    // The whole point: still inside that title.
    expect(new URL(page.url()).searchParams.get('media')).toBe(mediaId);
    // Not asserted on results: a word lifted from one sentence may genuinely have
    // no other occurrence in that title, and an empty result set is the correct
    // answer to the search that was asked for.
    await expect(search.searchInput).toHaveValue(headword);
  });

  test('lands on a plain search when there is no title to keep', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    const headword = await search.openFirstTokenCard({ excluding: QUERY });
    await search.tokenCardSearch.click();

    await expect.poll(() => search.searchedWord(), { timeout: 10_000 }).toBe(headword);
    expect(new URL(page.url()).searchParams.get('media')).toBeNull();
  });

  test('agrees with typing the same word into the box', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto(QUERY);
    await search.expectResultsVisible();

    await search.segmentCards.first().getByTestId('segment-media-name').click();
    await expect(page).toHaveURL(/media=/, { timeout: 10_000 });
    const scopedUrl = page.url();
    await search.expectResultsVisible();

    // Clicked first, so the word compared against is the one the card actually
    // searched for. Waiting on "the URL moved" rather than on the word itself:
    // a headword equal to the query the page is already on would satisfy that
    // check before the click had gone anywhere -- which `excluding` now rules
    // out at the source, for every caller rather than just this one.
    const headword = await search.openFirstTokenCard({ excluding: QUERY });
    await search.tokenCardSearch.click();
    await page.waitForURL((url) => url.toString() !== scopedUrl, { timeout: 10_000 });
    expect(search.searchedWord()).toBe(headword);
    const clickedUrl = new URL(page.url());

    // The same word, typed, from the same starting URL.
    await page.goto(scopedUrl);
    await search.expectResultsVisible();
    // Wait for the box to hold the URL's word before replacing it. The bar
    // re-seeds itself from the route once the navigation is confirmed, so text
    // typed before that lands is silently overwritten -- and the submit then
    // re-runs the search already on screen instead of the new one.
    await expect(search.searchInput).toHaveValue(QUERY);
    await search.searchInput.fill(headword);
    await expect(search.searchInput).toHaveValue(headword);
    await search.searchButton.click();
    if (headword !== QUERY) {
      await page.waitForURL((url) => url.toString() !== scopedUrl, { timeout: 10_000 });
    }
    const typedUrl = new URL(page.url());

    // Same word, same scope, same URL -- however the reader got there.
    expect(clickedUrl.pathname).toBe(typedUrl.pathname);
    expect(clickedUrl.searchParams.get('media')).toBe(typedUrl.searchParams.get('media'));
  });
});
