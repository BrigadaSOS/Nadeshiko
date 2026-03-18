import { test, expect } from '../fixtures';

test.describe('Sentence page', () => {
  /**
   * Navigate to search results, extract a real sentence UUID from the first card,
   * then navigate to its sentence page. This is done per-test so failures are isolated.
   */
  async function gotoSentencePage(page: import('@playwright/test').Page) {
    await page.goto('/search/彼女');
    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const uuid = await card.getAttribute('id');
    await page.goto(`/sentence/${uuid}`);
    const sentenceCard = page.locator('.group.flex.flex-col').first();
    await expect(sentenceCard).toBeVisible({ timeout: 15_000 });
    return sentenceCard;
  }

  test('loads and displays the sentence', async ({ page }) => {
    await gotoSentencePage(page);
  });

  test('displays Japanese text', async ({ page }) => {
    const card = await gotoSentencePage(page);
    const japaneseText = card.locator('h3');
    await expect(japaneseText).toBeVisible();
    await expect(japaneseText).not.toBeEmpty();
  });

  test('displays translations', async ({ page }) => {
    const card = await gotoSentencePage(page);
    await expect(card.locator('span:text-is("EN")')).toBeVisible();
    await expect(card.locator('span:text-is("ES")')).toBeVisible();
  });

  test('displays media info', async ({ page }) => {
    const card = await gotoSentencePage(page);
    const mediaInfo = card.locator('p.text-white\\/50');
    await expect(mediaInfo).toBeVisible();
  });

  test('displays a screenshot image', async ({ page }) => {
    await gotoSentencePage(page);
    const image = page.locator('img[alt^="Screenshot for"]').first();
    await expect(image).toBeVisible();
  });

  test('has the search input', async ({ page }) => {
    await gotoSentencePage(page);
    const input = page.locator('#sentence-search-input');
    await expect(input).toBeVisible();
  });
});
