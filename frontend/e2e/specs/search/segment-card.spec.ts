import { test, expect } from '../../fixtures';
import { SearchPage } from '../../pages/SearchPage';

test.describe('Segment card', () => {
  let search: SearchPage;

  test.beforeEach(async ({ page }) => {
    search = new SearchPage(page);
    await search.goto('彼女');
    await search.expectResultsVisible();
  });

  test('displays Japanese text', async ({ page }) => {
    const japaneseText = search.segmentCards.first().locator('h3');
    await expect(japaneseText).toBeVisible();
    await expect(japaneseText).not.toBeEmpty();
  });

  test('displays EN and ES translations', async ({ page }) => {
    const card = search.segmentCards.first();
    await expect(card.locator('span:text-is("EN")')).toBeVisible();
    await expect(card.locator('span:text-is("ES")')).toBeVisible();
  });

  test('displays media name and episode info', async ({ page }) => {
    const mediaInfo = search.segmentCards.first().locator('p.text-white\\/50');
    await expect(mediaInfo).toBeVisible();
    await expect(mediaInfo).not.toBeEmpty();
  });

  test('displays action buttons', async ({ page }) => {
    const card = search.segmentCards.first();
    const copyButton = card.getByRole('button', { name: 'Copy' });
    const contextButton = card.getByRole('button', { name: 'Context' });

    await expect(copyButton).toBeVisible();
    await expect(contextButton).toBeVisible();
  });

  test('displays a screenshot image', async ({ page }) => {
    const image = search.segmentCards.first().locator('img[alt^="Screenshot for"]');
    await expect(image).toBeVisible();
  });

  test('displays an audio play button', async ({ page }) => {
    const audioButton = search.segmentCards.first().locator('button').first();
    await expect(audioButton).toBeVisible();
  });
});
