import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Search', () => {
  test('returns results for a Japanese query', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    const count = await search.getResultCount();
    expect(count).toBeGreaterThan(0);
  });

  test('returns results for an English query', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('school');
    await search.expectResultsVisible();
  });

  test('returns results for a Spanish query', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('Yo');
    await search.expectResultsVisible();
  });

  test('shows category tabs for broad queries', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectCategoryTabsVisible();
  });

  test('searching from the search page updates results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    await search.search('学校');
    await search.expectResultsVisible();
  });

  test('segment cards display images', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    await expect(search.segmentImages.first()).toBeVisible();
  });

  test('direct URL navigation works', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto();
    await expect(page).toHaveURL(/\/search$/);
  });
});
