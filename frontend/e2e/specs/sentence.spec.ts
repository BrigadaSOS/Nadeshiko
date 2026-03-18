import { test, expect } from '../fixtures';
import { SearchPage } from '../pages/SearchPage';

test.describe('Sentence page', () => {
  let sentenceUrl: string;

  test.beforeAll(async ({ browser }) => {
    // Get a valid sentence UUID from search results
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('banner-v2-migration-dismissed', 'true');
    });
    await page.goto('/search/彼女');
    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const uuid = await card.getAttribute('id');
    sentenceUrl = `/sentence/${uuid}`;
    await context.close();
  });

  test('loads and displays the sentence', async ({ page }) => {
    await page.goto(sentenceUrl);

    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  test('displays Japanese text', async ({ page }) => {
    await page.goto(sentenceUrl);

    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const japaneseText = card.locator('h3');
    await expect(japaneseText).toBeVisible();
    await expect(japaneseText).not.toBeEmpty();
  });

  test('displays translations', async ({ page }) => {
    await page.goto(sentenceUrl);

    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    await expect(card.locator('span:text-is("EN")')).toBeVisible();
    await expect(card.locator('span:text-is("ES")')).toBeVisible();
  });

  test('displays media info', async ({ page }) => {
    await page.goto(sentenceUrl);

    const card = page.locator('.group.flex.flex-col').first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    const mediaInfo = card.locator('p.text-white\\/50');
    await expect(mediaInfo).toBeVisible();
  });

  test('displays a screenshot image', async ({ page }) => {
    await page.goto(sentenceUrl);

    const image = page.locator('img[alt^="Screenshot for"]').first();
    await expect(image).toBeVisible({ timeout: 15_000 });
  });

  test('has the search input', async ({ page }) => {
    await page.goto(sentenceUrl);

    const input = page.locator('#sentence-search-input');
    await expect(input).toBeVisible({ timeout: 10_000 });
  });
});
