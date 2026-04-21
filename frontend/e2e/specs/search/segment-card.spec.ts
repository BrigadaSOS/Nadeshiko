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
    const japaneseText = search.segmentCards.first().getByTestId('segment-japanese-text');
    await expect(japaneseText).toBeVisible();
    await expect(japaneseText).not.toBeEmpty();
  });

  test('displays EN and ES translations', async ({ page }) => {
    const card = search.segmentCards.first();
    await expect(card.getByTestId('translation-badge-EN')).toBeVisible();
    await expect(card.getByTestId('translation-badge-ES')).toBeVisible();
  });

  test('displays media name and episode info', async ({ page }) => {
    const mediaInfo = search.segmentCards.first().getByTestId('segment-media-info');
    await expect(mediaInfo).toBeVisible();
    await expect(mediaInfo).not.toBeEmpty();
  });

  test('links media filters and timestamp to the sentence page', async ({ page }) => {
    const card = search.segmentCards.first();
    const mediaInfo = card.getByTestId('segment-media-info');
    const links = mediaInfo.locator('a');
    const timeLink = mediaInfo.getByTestId('segment-time-link');

    await expect(links).toHaveCount(3);
    await expect(links.first()).toHaveAttribute('href', /\/search\?media=/);
    await expect(links.nth(1)).toHaveAttribute('href', /\/search\?media=/);
    await expect(timeLink).toHaveAttribute('href', /\/sentence\//);
  });

  test('displays action buttons', async ({ page }) => {
    const card = search.segmentCards.first();
    const copyButton = card.getByRole('button', { name: 'Copy' });
    const contextButton = card.getByRole('button', { name: 'Context' });

    await expect(copyButton).toBeVisible();
    await expect(contextButton).toBeVisible();
  });

  test('displays a screenshot image', async ({ page }) => {
    const image = search.segmentCards.first().getByTestId('segment-image');
    await expect(image).toBeVisible();
  });

  test('displays an audio play button', async ({ page }) => {
    const audioButton = search.segmentCards.first().getByTestId('audio-play-button');
    await expect(audioButton).toBeVisible();
  });
});
