import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Keyboard navigation', () => {
  test.describe.configure({ mode: 'serial' });

  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('学校');
    await search.expectResultsVisible();

    // Blur the search input so keyboard events reach the segment handler
    await search.searchInput.blur();
    await expect(search.searchInput).not.toBeFocused();
  });

  test('Arrow Down highlights the first result', async ({ page }) => {
    await page.keyboard.press('ArrowDown');

    const firstCard = search.segmentCards.first();
    await expect(firstCard).toHaveAttribute('data-focused', 'true');
  });

  test('Arrow Down then Arrow Up stays on first result', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');

    const firstCard = search.segmentCards.first();
    const secondCard = search.segmentCards.nth(1);

    await expect(firstCard).toHaveAttribute('data-focused', 'true');
    await expect(secondCard).toHaveAttribute('data-focused', 'false');
  });

  test('Arrow Down twice highlights the second result', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    const secondCard = search.segmentCards.nth(1);
    await expect(secondCard).toHaveAttribute('data-focused', 'true');
  });

  test('keyboard navigation does not activate when input is focused', async ({ page }) => {
    await search.searchInput.click();
    await expect(search.searchInput).toBeFocused();
    await page.keyboard.press('ArrowDown');

    const firstCard = search.segmentCards.first();
    await expect(firstCard).toHaveAttribute('data-focused', 'false');
  });
});
