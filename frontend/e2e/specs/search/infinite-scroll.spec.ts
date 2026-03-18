import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Infinite scroll', () => {
  test('shows end of results message after all results load', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();

    // With a small result set the end message should appear quickly
    await expect(search.endOfResults).toBeVisible({ timeout: 10_000 });
  });

  test('loading more results when scrolling down', async ({ page }) => {
    const search = new SearchPage(page);
    // Use a broad query to maximize result count
    await search.goto('学校');
    await search.expectResultsVisible();

    const initialCount = await search.getResultCount();

    // If the dataset is small enough to fit in one page, just verify end-of-results appears
    if (initialCount < 30) {
      await expect(search.endOfResults).toBeVisible({ timeout: 10_000 });
      return;
    }

    // Scroll to trigger loading more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    await page.waitForFunction(
      (initial) => document.querySelectorAll('.group.flex.flex-col').length > initial,
      initialCount,
      { timeout: 15_000 },
    );

    const newCount = await search.getResultCount();
    expect(newCount).toBeGreaterThan(initialCount);
  });
});
