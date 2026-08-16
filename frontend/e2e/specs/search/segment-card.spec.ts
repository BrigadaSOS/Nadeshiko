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

  /**
   * The interface language decides which translations are asked for, until a
   * reader saves a global override -- `defaultTranslationLanguages`, whose own
   * unit test spells out `'en' -> ['EN']`. This suite runs signed out in the
   * English locale, so English is the whole of what a card should carry here.
   *
   * This used to assert EN *and* ES, from when search fetched both regardless.
   * It is not asserting the absence of Spanish either: that would pin a product
   * default into a test whose subject is the card. Covering the two-language
   * rendering needs a reader who has chosen both, which is a signed-in spec and
   * does not exist yet.
   */
  test('displays the translation for the interface language', async ({ page }) => {
    const card = search.segmentCards.first();
    await expect(card.getByTestId('translation-badge-EN')).toBeVisible();
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
    // `/search/彼女?media=` and NOT `/search?media=`: the word stays in the path
    // it was searched on. This assertion used to read `/\/search\?media=/`,
    // which is why the search-dropping regression shipped green -- it did not
    // merely miss the bug, it pinned it in place.
    const filterHref = new RegExp(`/search/${encodeURIComponent('彼女')}\\?media=`);
    await expect(links.first()).toHaveAttribute('href', filterHref);
    await expect(links.nth(1)).toHaveAttribute('href', filterHref);
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
