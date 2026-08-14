import { test, expect } from '../../auth';
import { SearchPage } from '../../pages/SearchPage';

const QUERY = '学校';

async function accountSearchQueries(page: import('@playwright/test').Page): Promise<string[]> {
  const response = await page.request.get('/v1/user/activity?activityType=SEARCH&take=100');
  if (!response.ok()) return [];
  const data = (await response.json()) as { activities?: Array<{ searchQuery?: string }> };
  return (data.activities ?? []).map((activity) => activity.searchQuery ?? '');
}

/**
 * The half of the list that follows a reader between devices: their account's
 * SEARCH activity, the same rows `/user/activity` lists.
 *
 * Serial and stateful on purpose -- the row the first test files is the one the
 * second forgets and the third clears.
 */
test.describe('Recent searches (account)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a search on one device shows up on a device that has never seen it', async ({ authenticatedPage }) => {
    const search = new SearchPage(authenticatedPage);

    await search.goto(QUERY);
    await search.expectResultsVisible();
    await expect.poll(() => accountSearchQueries(authenticatedPage), { timeout: 15_000 }).toContain(QUERY);

    // Wipe what this device knows. Anything left in the menu can only have come
    // back from the account, which is the whole claim being tested.
    await authenticatedPage.evaluate(() => localStorage.removeItem('nd-search-recents'));
    await authenticatedPage.goto('/search');
    await search.expectHydrated();

    await search.openRecents();
    // The unscoped row specifically: the same word searched inside a title is a
    // separate row that the account may also be holding, and it is not the one
    // this test is about.
    await expect(search.unscopedRecentsItem(QUERY)).toHaveCount(1);
  });

  test('forgetting a row deletes it from the account, not just this device', async ({ authenticatedPage }) => {
    const search = new SearchPage(authenticatedPage);

    await authenticatedPage.goto('/search');
    await search.expectHydrated();
    await search.openRecents();

    await search.recentsItem(QUERY).first().getByTestId('search-recents-forget').click();

    // A row deleted only on the device would come straight back on the next
    // load, since the account is what the next device reads.
    await expect.poll(() => accountSearchQueries(authenticatedPage), { timeout: 15_000 }).not.toContain(QUERY);
  });

  test('clearing empties the account history before it empties the browser', async ({ authenticatedPage }) => {
    const search = new SearchPage(authenticatedPage);

    await search.goto(QUERY);
    await search.expectResultsVisible();
    await expect.poll(() => accountSearchQueries(authenticatedPage), { timeout: 15_000 }).toContain(QUERY);

    await authenticatedPage.goto('/search');
    await search.expectHydrated();
    await search.openRecents();
    await search.recentsClear.click();

    await expect(search.recentsMenu).toBeHidden();
    await expect.poll(() => accountSearchQueries(authenticatedPage), { timeout: 15_000 }).toHaveLength(0);
  });
});
