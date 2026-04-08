import { test, expect } from '../fixtures';
import { getE2EBaseUrl } from '../env';

test.describe('Sentence page', () => {
  let sentenceUuid: string;

  test.beforeAll(async ({ browser }) => {
    const baseUrl = getE2EBaseUrl();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/search/彼女`);
    await page.locator('#__nuxt').waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
    const card = page.getByTestId('segment-card').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const uuid = await card.getAttribute('id');
    if (!uuid) throw new Error('Could not find sentence UUID from search results');
    sentenceUuid = uuid;
    await context.close();
  });

  async function gotoSentencePage(page: import('@playwright/test').Page) {
    await page.goto(`/sentence/${sentenceUuid}`);
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
