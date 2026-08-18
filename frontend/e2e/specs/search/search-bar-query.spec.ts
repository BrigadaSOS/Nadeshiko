import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

/**
 * One rule, checked from each direction a search can reach the page: if the URL
 * names a search, the bar names the same one.
 *
 * The case that broke it was a clicked token. The bar used to read Nuxt's
 * `useRoute()`, which is deliberately withheld until the incoming *page*
 * renders whenever the page key changes -- and `/search/[[query]]` keys on the
 * query, so every token click changes it. The incoming page suspends on its own
 * `useAsyncData`, while `SearchContainer` has already swapped the results in
 * from its `onBeforeRouteUpdate`. For those few hundred milliseconds the bar
 * named the previous word and the sentences under it were the new one.
 *
 * Hence the shape of the assertion: the bar is read once the URL has changed,
 * with nothing waited for in between. Anything that puts the bar behind a fetch
 * again fails here, and a test that merely polled until they agreed would not.
 */
test.describe('The search bar shows the search in the URL', () => {
  test('a clicked token is in the bar as soon as the URL is', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    // Excluding the word the page is already on: searching it would navigate to
    // the URL we are standing on, and the wait below is for the URL to change.
    const word = await search.openFirstTokenCard({ excluding: '彼女' });
    await search.tokenCardSearch.click();
    await page.waitForURL((url) => !url.pathname.endsWith(encodeURIComponent('彼女')), {
      timeout: 15_000,
      waitUntil: 'commit',
    });

    expect(await search.searchInput.inputValue()).toBe(word);
    expect(word).toBe(decodeURIComponent(new URL(page.url()).pathname.split('/search/')[1] ?? ''));
  });

  test('going back restores the search that URL was for', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    await search.search('猫');
    await search.expectResultsVisible();
    await expect(search.searchInput).toHaveValue('猫');

    await page.goBack();
    await page.waitForURL(/\/search\/%E5%AD%A6%E6%A0%A1$/, { timeout: 15_000, waitUntil: 'commit' });
    await expect(search.searchInput).toHaveValue('学校');
  });

  test('a search page with no query leaves the bar empty', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('猫');
    await search.expectResultsVisible();

    await search.goto();
    await search.expectHydrated();
    await expect(search.searchInput).toHaveValue('');
  });
});

/**
 * The consequence of the rule above: a results page arrives with the bar full,
 * so the reader who wants a different search has to empty it first.
 *
 * There used to be nothing to press, and the heatmap showed what they did
 * instead -- roughly 5.8k rageclicks in thirty days, all on this input, a few
 * pixels right of where the query text ends. That is a triple-click select-all,
 * counted as rage because it is three clicks in one spot. The field itself was
 * never broken, which is why nothing else caught this: it just asked for a
 * gesture where it should have offered a control.
 */
test.describe('Clearing the search bar', () => {
  test('the button is there only when there is something to clear', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('猫');
    await search.expectResultsVisible();
    await expect(search.searchClear).toBeVisible();

    await search.searchClear.click();
    await expect(search.searchClear).toBeHidden();
  });

  test('clearing empties the bar and leaves the caret in it', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const urlBefore = page.url();
    await search.searchClear.click();

    await expect(search.searchInput).toHaveValue('');
    // Focus comes back to the field rather than staying on the button, so the
    // next keystroke is the next search instead of being swallowed.
    await expect(search.searchInput).toBeFocused();
    // Clearing the bar is not a navigation: the results under it are still the
    // ones the URL names until a new search is submitted.
    expect(page.url()).toBe(urlBefore);
  });

  test('a cleared bar can be typed into and searched straight away', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    await search.searchClear.click();
    await search.searchInput.fill('猫');
    await search.searchInput.press('Enter');

    await page.waitForURL(/\/search\/%E7%8C%AB$/, { timeout: 15_000, waitUntil: 'commit' });
    await expect(search.searchInput).toHaveValue('猫');
  });
});
