import { type Locator, type Page, expect } from '@playwright/test';

export class SearchPage {
  readonly page: Page;
  readonly searchInput: Locator;
  readonly searchClear: Locator;
  readonly searchButton: Locator;
  readonly categoryTabs: Locator;
  readonly segmentCards: Locator;
  readonly segmentImages: Locator;
  readonly episodeLinks: Locator;
  readonly endOfResults: Locator;
  readonly enToggle: Locator;
  readonly esToggle: Locator;
  readonly furiganaToggle: Locator;
  readonly recentsMenu: Locator;
  readonly recentsItems: Locator;
  readonly recentsClear: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId('search-input');
    // Only in the DOM while the bar holds something to clear.
    this.searchClear = page.getByTestId('search-clear');
    this.recentsMenu = page.getByTestId('search-recents');
    this.recentsItems = page.getByTestId('search-recents-item');
    this.recentsClear = page.getByTestId('search-recents-clear');
    this.searchButton = page.getByTestId('search-button');
    this.categoryTabs = page.getByTestId('search-category-tabs');
    this.segmentCards = page.getByTestId('segment-card');
    this.segmentImages = page.getByTestId('segment-image');
    // Only on cards with an episode behind them: a movie has none, and a
    // YouTube clip links out to the video instead.
    this.episodeLinks = page.getByTestId('segment-episode-link');
    this.endOfResults = page.getByText("You've reached the end", { exact: false });
    this.enToggle = page.getByTestId('visibility-en');
    this.esToggle = page.getByTestId('visibility-es');
    this.furiganaToggle = page.getByTestId('visibility-furigana');
  }

  visibilityOption(lang: 'en' | 'es' | 'furigana', mode: 'show' | 'spoiler' | 'hidden') {
    return this.page.getByTestId(`visibility-${lang}-option-${mode}`);
  }

  async setVisibility(lang: 'en' | 'es' | 'furigana', mode: 'show' | 'spoiler' | 'hidden') {
    const toggle = this.page.getByTestId(`visibility-${lang}`);
    await toggle.click();
    await this.visibilityOption(lang, mode).click();
  }

  /**
   * The word the current URL is a search for, decoded, or null on a `/search`
   * with no word in it.
   *
   * The query lives in the PATH and the filters live in the query string, so a
   * filter that rebuilds the path instead of patching the query silently drops
   * the search. That is a real regression -- `/search?media=X` is a valid page
   * showing every sentence in a title -- and it is invisible to any assertion
   * that only looks at `media=`, which is how it shipped.
   */
  searchedWord(): string | null {
    const path = decodeURIComponent(new URL(this.page.url()).pathname);
    const match = path.match(/\/search\/(.+)$/);
    return match?.[1] ?? null;
  }

  /** Open the first lookupable token with the Shirabe card. */
  async openFirstTokenCard(): Promise<void> {
    const token = this.page.locator('.token-text .token[role="button"]').first();
    await expect(token).toBeVisible({ timeout: 15_000 });
    await token.click();
    await expect(this.page.locator('.sb-host .sb-popup.sb-visible')).toBeVisible({ timeout: 5_000 });
  }
}
