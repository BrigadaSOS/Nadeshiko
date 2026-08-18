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
    // The headword at the top of an open word card, which is a button only when
    // the card is about a token the dictionary answered for.
    this.tokenCardSearch = page.locator('.token-tooltip__word--action');
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

  /**
   * `locale` prefixes the path, which the app routes on (`strategy: 'prefix'`).
   *
   * It is how a spec asks for a reader with two translation languages without
   * signing in: the interface language picks the default set until a reader
   * saves an override, and only `ja` defaults to both EN and ES — `en` gets
   * English alone, `es` Spanish alone. See `defaultTranslationLanguages`.
   */
  async goto(query?: string, options: { locale?: 'en' | 'es' | 'ja' } = {}) {
    const prefix = options.locale ? `/${options.locale}` : '';
    if (query) {
      await this.page.goto(`${prefix}/search/${encodeURIComponent(query)}`);
    } else {
      await this.page.goto(`${prefix}/search`);
    }
  }

  /**
   * Runs a search from the bar and waits for the URL to be the one asked for.
   *
   * Two things this used to get wrong, both of which showed up as a later step
   * timing out somewhere unrelated:
   *
   * `/\/search\//` matched the URL the page was ALREADY on, so this could
   * return before the navigation had happened at all — leaving the caller to
   * act on the previous search, and any history assertion after it reading a
   * stack that had not moved yet.
   *
   * `waitUntil: 'commit'` because the default is `'load'`: a results page whose
   * first card is a YouTube segment embeds a `youtube-nocookie.com` iframe, and
   * the page load state need never arrive. The URL is what this is waiting for.
   */
  async search(query: string) {
    await this.searchInput.clear();
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForURL((url) => url.pathname.endsWith(`/search/${encodeURIComponent(query)}`), {
      timeout: 10_000,
      waitUntil: 'commit',
    });
  }

  /**
   * Waits for hydration as well as for cards, because the cards arrive first.
   * They are server-rendered, so they are visible and clickable before Vue has
   * attached anything — the keyboard listener, the image-zoom click, the
   * infinite-scroll observer all mount later. Interacting in that window is
   * silently dropped, which is what made these specs flaky rather than red.
   */
  async expectResultsVisible() {
    await expect(this.segmentCards.first()).toBeVisible({ timeout: 15_000 });
    await this.expectHydrated();
  }

  /** Set by app/plugins/hydrated.client.ts once Vue finishes hydrating. */
  async expectHydrated() {
    await expect(this.page.locator('html[data-hydrated="true"]')).toBeAttached({ timeout: 15_000 });
  }

  async expectCategoryTabsVisible() {
    await expect(this.categoryTabs).toBeVisible({ timeout: 15_000 });
  }

  /**
   * Clicks into the box to drop the recents menu open. A click rather than
   * `focus()`: the bar focuses itself on mount for desktop readers, and that
   * focus deliberately does not open the menu.
   */
  async openRecents() {
    await this.searchInput.click();
    await expect(this.recentsMenu).toBeVisible({ timeout: 10_000 });
  }

  recentsItem(query: string) {
    return this.recentsItems.filter({ hasText: query });
  }

  /**
   * The row for a search run across everything, as opposed to the same word
   * searched inside a title -- which is a separate row, by design.
   *
   * The distinction matters to any count: filtering rows by their text alone
   * matches both, so `食べる` and `食べる in Bocchi` are two hits for one word.
   */
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
    return this.segmentCards
      .first()
      .getByTestId(`translation-row-${lang}`)
      .getByTestId('translation-content');
  }

  /**
   * Opens the word card on the first token in the results that has one, and
   * returns the headword it is about — which is what pressing the headword
   * searches for, and so what the bar has to end up holding.
   *
   * Walked rather than aimed at the first token, because only a word the
   * dictionary knows opens a card at all: particles and names in a given
   * sentence are tokens with no entry behind them, and which ones those are
   * depends on the sentence the search happens to return.
   *
   * `excluding` skips a headword the caller cannot use — in practice the word
   * the page is already searching for. Every result on `/search/彼女` contains
   * 彼女, so it is routinely the first token with an entry, and searching it
   * navigates to the URL the test is standing on. The callers that wait for the
   * URL to *change* then wait forever, for a reason that has nothing to do with
   * what they are testing.
   */
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

  /**
   * The headword as a word, with its reading stripped out.
   *
   * NOT `innerText()`. The card renders furigana as `<ruby>語<rt>ご</rt></ruby>`,
   * and text extraction concatenates both halves — so the headword of 林間学校
   * came back as "林間学校りんかんがっこう", which is not what pressing it
   * searches for and matches nothing in the URL afterwards. `<rt>` holds the
   * pronunciation guide by definition, so dropping it is what "the word" means
   * whether or not a given entry happens to have furigana.
   */
  private async tokenCardHeadword(): Promise<string> {
    const text = await this.tokenCardSearch.evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      for (const rt of clone.querySelectorAll('rt')) rt.remove();
      return clone.textContent ?? '';
    });
    return text.trim();
  }
}
