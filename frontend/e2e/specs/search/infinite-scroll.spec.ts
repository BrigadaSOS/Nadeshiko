import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Infinite scroll', () => {
  test('scrolling down loads more results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const initialCount = await search.getResultCount();

    // Keep scrolling until more results load or we give up
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);

      const currentCount = await search.getResultCount();
      if (currentCount > initialCount) {
        expect(currentCount).toBeGreaterThan(initialCount);
        return;
      }
    }

    // If scrolling didn't load more, the dataset fits in one page
    await expect(search.endOfResults).toBeVisible({ timeout: 10_000 });
  });
});
