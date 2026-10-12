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
  readonly tokenCardSearch: Locator;

  constructor(page: Page) {
    this.page = page;
    this.searchInput = page.getByTestId('search-input');
    // Only in the DOM while the bar holds something to clear.
    this.searchClear = page.getByTestId('search-clear');
    this.recentsMenu = page.getByTestId('search-recents');
    this.recentsItems = page.getByTestId('search-recents-item');
    this.recentsClear = page.getByTestId('search-recents-clear');
    // The dictionary headword is actionable only when the token has an entry.
    this.tokenCardSearch = page.locator('.token-tooltip__word--action');
    this.searchButton = page.getByTestId('search-button');
    this.categoryTabs = page.getByTestId('search-category-tabs');
    this.segmentCards = page.getByTestId('segment-card');
    this.segmentImages = page.getByTestId('segment-image');
    // Movies have no episode; YouTube clips link to the video instead.
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

  // Query words live in the path; checking only query-string filters misses a dropped word.
  // Return null for an unscoped /search browse.
  searchedWord(): string | null {
    const path = decodeURIComponent(new URL(this.page.url()).pathname);
    const match = path.match(/\/search\/(.+)$/);
    return match?.[1] ?? null;
  }

  // Locale prefixes select anonymous translation defaults: pt-BR uses EN+ES, es uses ES,
  // and other locales use EN until the reader saves an override. See defaultTranslationLanguages.
  async goto(query?: string, options: { locale?: 'en' | 'es' | 'ja' | 'zh' | 'zh-hant' | 'id' | 'pt-BR' } = {}) {
    const prefix = options.locale ? `/${options.locale}` : '';
    const path = query ? `${prefix}/search/${encodeURIComponent(query)}` : `${prefix}/search`;
    const response = await this.page.goto(path);
    expect(response?.status(), `search navigation to ${path} should return HTTP 200`).toBe(200);
  }

  // Wait for the requested word, not a /search/ pattern that already matches the old URL.
  // Use commit: a YouTube iframe can prevent the page's load event from arriving.
  async search(query: string) {
    await this.searchInput.clear();
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForURL((url) => url.pathname.endsWith(`/search/${encodeURIComponent(query)}`), {
      timeout: 10_000,
      waitUntil: 'commit',
    });
  }

  // SSR cards appear before Vue attaches handlers; wait for hydration before interacting.
  async expectResultsVisible() {
    await expect(this.segmentCards.first()).toBeVisible({ timeout: 15_000 });
    await this.expectHydrated();
  }

  /** Set by app/plugins/hydrated.client.ts once Vue finishes hydrating. */
  async expectHydrated() {
    await expect(this.page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 30_000 });
  }

  async expectCategoryTabsVisible() {
    await expect(this.categoryTabs).toBeVisible({ timeout: 15_000 });
  }

  // Click rather than focus: desktop mount autofocus intentionally does not open history.
  async openRecents() {
    await this.searchInput.click();
    await expect(this.recentsMenu).toBeVisible({ timeout: 10_000 });
  }

  recentsItem(query: string) {
    return this.recentsItems.filter({ hasText: query });
  }

  // Text alone matches both general and title-scoped searches for the same word.
  unscopedRecentsItem(query: string) {
    return this.recentsItem(query).filter({ hasNot: this.page.getByTestId('search-recents-media') });
  }

  async expectNoResults() {
    await expect(this.page.getByText('No results', { exact: false }).or(this.endOfResults)).toBeVisible({
      timeout: 10_000,
    });
  }

  getResultCount() {
    return this.segmentCards.count();
  }

  translationBadges(lang: 'EN' | 'ES') {
    return this.segmentCards.first().getByTestId(`translation-badge-${lang}`).first();
  }

  translationText(lang: 'EN' | 'ES') {
    return this.segmentCards.first().getByTestId(`translation-row-${lang}`).getByTestId('translation-content');
  }

  // Walk tokens because particles/names may have no dictionary entry. Return the actionable
  // headword; excluding skips the current query so callers waiting for a URL change do not hang.
  async openFirstTokenCard(options: { excluding?: string } = {}): Promise<string> {
    const tokens = this.page.locator('.token-text .token[role="button"]');
    await expect(tokens.first()).toBeVisible({ timeout: 15_000 });

    for (let i = 0; i < (await tokens.count()); i++) {
      await tokens.nth(i).click();
      if (await this.tokenCardSearch.isVisible({ timeout: 2_500 }).catch(() => false)) {
        const headword = await this.tokenCardHeadword();
        if (headword !== options.excluding) return headword;
      }
      await this.page.keyboard.press('Escape');
    }

    throw new Error('no token in the results opened a usable word card');
  }

  // Strip ruby <rt> readings: innerText/textContent otherwise concatenate pronunciation
  // with the headword, which no longer matches the word searched by a click.
  private async tokenCardHeadword(): Promise<string> {
    const text = await this.tokenCardSearch.evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const rt of clone.querySelectorAll('rt')) rt.remove();
      return clone.textContent ?? '';
    });
    return text.trim();
  }
}
