import { test, expect } from '../fixtures';

test.describe('Sentence page', () => {
  /**
   * Navigate to search results, extract a real sentence UUID from the first card,
   * then navigate to its sentence page. This is done per-test so failures are isolated.
   */
  async function gotoSentencePage(page: import('@playwright/test').Page) {
    await page.goto('/search/彼女');
    const card = page.getByTestId('segment-card').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const uuid = await card.getAttribute('id');
    await page.goto(`/sentence/${uuid}`);
    const sentenceCard = page.getByTestId('segment-card').first();
    await expect(sentenceCard).toBeVisible({ timeout: 15_000 });
    return sentenceCard;
  }

  test('loads and displays the sentence', async ({ page }) => {
    await gotoSentencePage(page);
  });

  test('displays Japanese text', async ({ page }) => {
    const card = await gotoSentencePage(page);
    const japaneseText = card.getByTestId('segment-japanese-text');
    await expect(japaneseText).toBeVisible();
    await expect(japaneseText).not.toBeEmpty();
  });

  test('displays translations', async ({ page }) => {
    const card = await gotoSentencePage(page);
    await expect(card.getByTestId('translation-badge-EN')).toBeVisible();
    await expect(card.getByTestId('translation-badge-ES')).toBeVisible();
  });

  test('displays media info', async ({ page }) => {
    const card = await gotoSentencePage(page);
    const mediaInfo = card.getByTestId('segment-media-info');
    await expect(mediaInfo).toBeVisible();
  });

  test('displays a screenshot image', async ({ page }) => {
    await gotoSentencePage(page);
    const image = page.getByTestId('segment-image').first();
    await expect(image).toBeVisible();
  });

  test('has the search input', async ({ page }) => {
    await gotoSentencePage(page);
    const input = page.getByTestId('search-input');
    await expect(input).toBeVisible();
  });
});
