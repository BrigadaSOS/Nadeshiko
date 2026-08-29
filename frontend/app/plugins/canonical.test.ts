import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The canonical link, `og:url`, and the hreflang set.
 *
 * All three used to be built separately and disagreed: the canonical
 * deliberately keeps `media` and `episode` on a faceted search while `og:url`
 * was never set at all and fell back to a path-only default -- one head making
 * two contradictory claims about the same page.
 *
 * The rest of this exists because of one loop. `route.path` is a percent-
 * encoding layer deeper than the URL that was requested, so emitting it as a
 * link advertises a NEW url on every render -- and the hreflang set from
 * `useLocaleHead()` did the same thing four times over, three of them under
 * locales nobody asked for. Every href here is built from `canonicalPath` and
 * never from `route.path`, which is the whole point of the plugin.
 */
const route = reactive({
  path: '/en/search/kanji',
  params: {} as Record<string, unknown>,
  query: {} as Record<string, unknown>,
});
const head = { link: (() => []) as () => unknown[], meta: (() => []) as () => unknown[] };

vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin);
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useSiteConfig', () => ({ url: 'https://nadeshiko.moe' }));
vi.stubGlobal('useHead', (input: { link: () => unknown[]; meta: () => unknown[] }) => {
  head.link = input.link;
  head.meta = input.meta;
});

// Imported on first use rather than at the top: a static import is hoisted
// above the `stubGlobal` calls, and the module calls `defineNuxtPlugin` as it
// loads.
let canonicalPlugin: (() => void) | null = null;

type Link = { rel: string; href: string; hreflang?: string; id?: string };

/** Runs the plugin over the current route and reads the head back. */
async function render() {
  canonicalPlugin ??= ((await import('./canonical')) as unknown as { default: () => void }).default;
  canonicalPlugin();
  const links = head.link() as Link[];
  const meta = head.meta() as { property: string; content: string }[];
  return {
    canonical: links.find((link) => link.rel === 'canonical')!.href,
    alternates: links.filter((link) => link.rel === 'alternate'),
    ogUrl: meta.find((entry) => entry.property === 'og:url')!.content,
  };
}

const at = (path: string, query: Record<string, unknown> = {}, params: Record<string, unknown> = {}) => {
  route.path = path;
  route.query = query;
  route.params = params;
};

beforeEach(() => {
  at('/en/search/kanji');
});

describe('the canonical URL', () => {
  test('is absolute, so it names one page rather than one path', async () => {
    at('/en/media');

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/media');
  });

  test('is encoded ONCE, not once per render', async () => {
    // `route.path` is a percent-encoding layer deeper than the URL that was
    // requested, so emitting it re-encodes the escapes themselves --
    // `%E3%81%A0` becomes `%25E3%2581%25A0`, a search for the literal eleven
    // characters, which renders an empty page at HTTP 200. Every render
    // advertised a new, longer URL than the last.
    at('/en/search/%25E3%2581%25A0', {}, { query: 'だ' });

    const { canonical } = await render();
    expect(canonical).toBe('https://nadeshiko.moe/en/search/%E3%81%A0');
    expect(canonical).not.toContain('%25');
  });

  test('and `og:url` says exactly the same thing', async () => {
    // They disagreed, which is one head making two claims about one page.
    at('/en/search/kanji', { media: 'm1' });

    const { canonical, ogUrl } = await render();
    expect(ogUrl).toBe(canonical);
  });
});

describe('which query parameters survive', () => {
  test('a faceted search keeps the facets, which are different sets of results', async () => {
    at('/en/search/kanji', { media: 'm1', episode: '3', category: 'anime' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/kanji?media=m1&episode=3&category=anime');
  });

  test('but drops everything else, which only reorders or decorates', async () => {
    at('/en/search/kanji', { media: 'm1', sort: 'recent', page: '2', utm_source: 'x' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/kanji?media=m1');
  });

  test('keeps them in a fixed order, so two orderings are not two URLs', async () => {
    at('/en/search/kanji', { category: 'anime', media: 'm1' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/kanji?media=m1&category=anime');
  });

  test('drops a parameter that is present but empty', async () => {
    at('/en/search/kanji', { media: '' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/kanji');
  });

  test('drops a repeated parameter rather than guessing which one was meant', async () => {
    at('/en/search/kanji', { media: ['m1', 'm2'] });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/kanji');
  });

  test('the catalogue keeps its CURSOR, because each page is its own set of titles', async () => {
    // Collapsing pages 2..n onto `/media` tells a crawler the only page worth
    // keeping is the first, which is the opposite of why the next-page link
    // exists.
    at('/en/media', { cursor: 'abc', category: 'anime' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/media?category=anime&cursor=abc');
  });

  test('a title page keeps the episode, which is its own list of sentences', async () => {
    at('/en/media/oshi-no-ko', { episode: '3' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/media/oshi-no-ko?episode=3');
  });

  test('but not the sort, which would multiply a title into one URL per order', async () => {
    at('/en/media/oshi-no-ko', { episode: '3', sort: 'oldest' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/media/oshi-no-ko?episode=3');
  });

  test('the frequency list keeps its TIER, each being a different set of words', async () => {
    // Without this the six non-default tiers all consolidate away into the bare
    // page.
    at('/en/stats/words', { tier: '3' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/stats/words?tier=3');
  });

  test('and its filter, which the sitemap itself points at', async () => {
    // A canonical that dropped it would advertise a URL listing words whose
    // search pages are `noindex`.
    at('/en/stats/words', { filter: 'COVERED' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/stats/words?filter=COVERED');
  });

  test('a page with no rule of its own keeps no parameters at all', async () => {
    at('/en/blog', { page: '2' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/blog');
  });
});

describe('the sentence search', () => {
  test('points at the permalink it is a search FOR', async () => {
    // `/search/sentence?query=<id>` and `/sentence/<id>` are the same page.
    at('/en/search/sentence', { query: 'seg-9' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/sentence/seg-9');
  });

  test('and at itself when there is no sentence in the query', async () => {
    at('/en/search/sentence', {});

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/search/sentence');
  });

  test('carries no query string over to the permalink', async () => {
    at('/en/search/sentence', { query: 'seg-9', media: 'm1' });

    expect((await render()).canonical).toBe('https://nadeshiko.moe/en/sentence/seg-9');
  });
});

describe('the hreflang set', () => {
  test('names every locale that is actually indexed', async () => {
    at('/en/media');

    const { alternates } = await render();
    expect(alternates.map((link) => link.hreflang)).toEqual(['en', 'es', 'x-default']);
  });

  test('leaves out the one that is noindex everywhere', async () => {
    // An hreflang set pointing at noindexed URLs contradicts itself.
    at('/en/media');

    expect((await render()).alternates.map((link) => link.hreflang)).not.toContain('ja');
  });

  test('points each locale at the same page in that locale', async () => {
    at('/en/media/oshi-no-ko', { episode: '3' });

    const { alternates } = await render();
    expect(alternates.find((link) => link.hreflang === 'es')?.href).toBe(
      'https://nadeshiko.moe/es/media/oshi-no-ko?episode=3',
    );
  });

  test('answers x-default with English', async () => {
    at('/en/media');

    expect((await render()).alternates.find((link) => link.hreflang === 'x-default')?.href).toBe(
      'https://nadeshiko.moe/en/media',
    );
  });

  test('carries the canonical query string, not the raw one', async () => {
    at('/en/search/kanji', { media: 'm1', sort: 'recent' });

    for (const link of (await render()).alternates) {
      expect(link.href).toContain('?media=m1');
      expect(link.href).not.toContain('sort');
    }
  });

  test('names nothing at all for a path with no locale prefix', async () => {
    // Under `prefix` strategy every page URL carries one, so a path without one
    // is not a page whose language variants can be named -- and naming them
    // anyway invents three URLs.
    at('/api/health');

    expect((await render()).alternates).toEqual([]);
  });

  test('gives each link the id the i18n module uses, so a duplicate collapses', async () => {
    at('/en/media');

    expect((await render()).alternates.map((link) => link.id)).toEqual(['i18n-alt-en', 'i18n-alt-es', 'i18n-xd']);
  });
});
