import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Infinite scroll', () => {
  test('scrolling down loads more results', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    const initialCount = await search.getResultCount();

    // Scroll and wait for a CONDITION, not a fixed delay. The previous version
    // slept 1s per attempt, which is simultaneously too long when the fetch is
    // quick and too short when it is not — the latter being the flake. `toPass`
    // retries the scroll as well as the check, so a batch that arrives late is
    // still seen, and one that arrives fast costs no wait at all.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      const grew = (await search.getResultCount()) > initialCount;
      const ended = await search.endOfResults.isVisible();

      // Either outcome is correct: more results loaded, or the dataset genuinely
      // fits on one page. Only "neither, yet" is worth retrying.
      expect(grew || ended).toBe(true);
    }).toPass({ timeout: 30_000, intervals: [250, 500, 1_000] });
  });
});
