// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const sdkHttp = vi.hoisted(() => ({
  search: vi.fn(),
  getSearchStats: vi.fn(),
}));

vi.mock('@brigadasos/nadeshiko-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@brigadasos/nadeshiko-sdk')>();
  return {
    ...actual,
    search: sdkHttp.search,
    getSearchStats: sdkHttp.getSearchStats,
  };
});
import { defineComponent, reactive, ref, unref } from 'vue';
import { mediaMetaI18n, formatMediaMetaNumber, expectedMediaMeta } from '../../../test/media-meta-fixtures';

/**
 * The search page, whose interesting output is what it tells CRAWLERS.
 *
 * `noindex` on a thin page is right; `noindex` on a page whose fetch merely
 * failed is a backend blip de-indexing good pages wholesale, which is far more
 * expensive than briefly indexing a thin one. The two arrive here looking almost
 * identical -- no results either way -- and only an explicit outcome separates them.
 *
 * The breadcrumb has the same shape of decision: a media-scoped page sits under
 * the catalogue and a word page under search, and emitting the trail that does
 * not match is worse than emitting none, because it names a parent the page does
 * not have.
 */
const capturedRobots: unknown[] = [];
const capturedSchema: unknown[] = [];
const route = reactive({
  path: '/en/search/cat',
  params: { query: 'cat' },
  query: {} as Record<string, unknown>,
  fullPath: '/en/search/cat',
});
const sentenceOutcome = ref<Record<string, unknown> | null>(null);
const fetchStats = vi.fn();
const navigateTo = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/en/search/cat'));
vi.stubGlobal('useRequestTraffic', () => 'reader');
vi.stubGlobal('navigateTo', navigateTo);
vi.stubGlobal('useRobotsRule', (v: unknown) => capturedRobots.push(v));
const useHead = vi.fn();
vi.stubGlobal('useHead', useHead);
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useSchemaOrg', (v: unknown) => capturedSchema.push(v));
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => ({ '@type': 'WebPage', ...v }));
vi.stubGlobal('defineBreadcrumb', (v: Record<string, unknown>) => ({ '@type': 'BreadcrumbList', ...v }));
vi.stubGlobal('definePageMeta', vi.fn());
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m?.nameEn ?? '',
  language: ref('ENGLISH'),
}));
vi.stubGlobal('useContentRating', () => ({
  shouldBlur: () => false,
  isRestricted: () => false,
  contentRating: ref(['SAFE']),
}));
vi.stubGlobal('useHiddenMedia', () => ({
  hiddenMediaIds: ref([]),
  hiddenMediaExcludeFilter: ref([]),
  isMediaHidden: () => false,
}));
vi.stubGlobal('useHiddenCategories', () => ({
  hiddenCategories: ref([]),
  hasHiddenCategories: ref(false),
  isCategoryHidden: () => false,
}));
vi.stubGlobal('useFavoriteMedia', () => ({ favoriteMediaIds: ref(new Set()) }));
vi.stubGlobal('useFamiliarMedia', () => ({
  entries: ref([]),
  inferredRank: ref(new Map()),
  load: vi.fn(),
  forget: vi.fn(),
}));
vi.stubGlobal('useDefaultSearchCategory', () => ({
  storedDefault: ref('all'),
  defaultCategorySlug: ref('all'),
  isDefaultCategoryHidden: ref(false),
}));
vi.stubGlobal('useTranslationVisibility', () => ({
  englishMode: ref('visible'),
  spanishMode: ref('visible'),
  includedLanguages: ref(['EN']),
}));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(['EN']), dictionaryGlossLanguages: ref(['en']) }));
function stubPrimedSearchFetch() {
  vi.stubGlobal('useSearchFetch', () => ({
    fetchSentences: vi.fn().mockImplementation(async () => sentenceOutcome.value),
    fetchStats,
    cancelSentences: vi.fn(),
    cancelStats: vi.fn(),
  }));
}
stubPrimedSearchFetch();
// `getMedia` included: the page resolves a `?media=` scope through it, and an
// SDK stub without it sends that straight to the failure path -- where the
// breadcrumb's title never resolves and the assertion about it means nothing.
const useNadeshikoSdk = () => ({
  getMedia: vi.fn().mockResolvedValue({ publicId: 'm1', nameEn: 'Bocchi', slug: 'bocchi' }),
});
vi.stubGlobal('useNadeshikoSdk', useNadeshikoSdk);
vi.stubGlobal('userStore', () => ({ isLoggedIn: false, userEmail: null, preferences: {} }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
vi.stubGlobal(
  'createError',
  vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v)),
);

function stubPrimedAsyncData() {
  vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
    const data = ref(await handler());
    return { data, error: ref(null), refresh: vi.fn(), pending: ref(false) };
  });
}
stubPrimedAsyncData();

import { createSearchFetcher } from '~/composables/useSearchFetch';
import { getStringQueryValue } from '~/utils/routes';
vi.stubGlobal('getStringQueryValue', getStringQueryValue);

import SearchQueryPage from './[[query]].vue';

const mounted: { unmount: () => void }[] = [];

async function render(
  sentences: Record<string, unknown> | null,
  path = '/en/search/cat',
  query: Record<string, unknown> = {},
  outcomeOverride?: Record<string, unknown>,
) {
  capturedRobots.length = 0;
  capturedSchema.length = 0;
  sentenceOutcome.value =
    outcomeOverride ??
    (sentences === null ? { status: 'error', failure: { kind: 'unavailable' } } : { status: 'ok', data: sentences });
  route.path = path;
  route.fullPath = path;
  route.query = query;
  route.params = { query: path.split('/search/')[1] ?? '' };

  const Host = defineComponent({
    components: { SearchQueryPage },
    template: '<Suspense><SearchQueryPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchBaseInputSegment: true,
        SearchContainer: {
          name: 'SearchContainer',
          props: ['initialSentenceOutcome', 'initialStatsOutcome'],
          template: '<div />',
        },
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        UiBaseIcon: true,
        MediaHeader: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const robotsRule = () => capturedRobots[0];
const crumbs = () =>
  (capturedSchema
    .flatMap((e) => (unref(e) as Record<string, unknown>[]) ?? [])
    .find((n) => n['@type'] === 'BreadcrumbList')?.itemListElement as { name: string }[]) ?? [];

const hits = (n: number) => ({
  results: Array.from({ length: n }, () => ({
    segment: { publicId: 's' },
    media: { publicId: 'm', nameEn: 'Bocchi' },
  })),
  pagination: { estimatedTotalHits: n },
});

beforeEach(() => {
  vi.clearAllMocks();
  mediaMetaI18n.locale.value = 'en';
  sdkHttp.search.mockReset();
  sdkHttp.getSearchStats.mockReset();
  stubPrimedSearchFetch();
  stubPrimedAsyncData();
  vi.stubGlobal('userStore', () => ({ isLoggedIn: false, userEmail: null, preferences: {} }));
  vi.stubGlobal('useFavoriteMedia', () => ({ favoriteMediaIds: ref(new Set()) }));
  vi.stubGlobal('useFamiliarMedia', () => ({
    entries: ref([]),
    inferredRank: ref(new Map()),
    load: vi.fn(),
    forget: vi.fn(),
  }));
  vi.stubGlobal('useDefaultSearchCategory', () => ({
    storedDefault: ref('all'),
    defaultCategorySlug: ref('all'),
    isDefaultCategoryHidden: ref(false),
  }));
  vi.stubGlobal('useNadeshikoSdk', useNadeshikoSdk);
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
  vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
  fetchStats.mockResolvedValue({ status: 'ok', data: { media: [], categories: [] } });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('what the page tells crawlers', () => {
  test('a search with results is indexable', async () => {
    await render(hits(12));

    expect(robotsRule()).toBeUndefined();
  });

  test('a search that genuinely found nothing is noindex, follow', async () => {
    // Thin, and worth keeping out of the index -- but still worth crawling
    // through, which is what `follow` is for.
    await render(hits(0));

    expect(robotsRule()).toBe('noindex, follow');
  });

  test('but a FAILED fetch is NOT, because a blip must not de-index good pages', async () => {
    // The expensive mistake: an error outcome means the fetch fell over, and treating it
    // like an empty result de-indexes wholesale on a backend wobble.
    //
    // The rule has to be asserted as CALLED with nothing, not merely absent: a
    // version that dereferences the null throws before it ever calls, and
    // "no rule was set" would then pass for a page that failed to render.
    await render(null);

    expect(capturedRobots).toHaveLength(1);
    expect(robotsRule()).toBeUndefined();
  });

  test('and the bare search page is left alone', async () => {
    // No query means nothing was searched; it is not a thin result page.
    await render(hits(0), '/en/search');

    expect(robotsRule()).toBeUndefined();
  });
});

describe('the breadcrumb trail', () => {
  test('a word search sits under the search page', async () => {
    await render(hits(3), '/en/search/cat');

    expect(crumbs().map((c) => c.name)).toEqual(['navbar.buttons.home', 'seo.search.title', 'cat']);
  });

  test('a media-scoped page sits under the CATALOGUE instead', async () => {
    // Naming a parent the page does not have is worse than naming none.
    await render(hits(3), '/en/search', { media: 'm1' });

    const names = crumbs().map((c) => c.name);
    expect(names).toContain('seo.media.title');
    expect(names).not.toContain('cat');
  });

  test('and names the title once its first result identifies it', async () => {
    await render(hits(3), '/en/search', { media: 'm1' });

    expect(crumbs().map((c) => c.name)).toContain('Bocchi');
  });

  test('a media page with no results yet names no title at all', async () => {
    // The title comes off the first result, so before there is one the trail
    // must stop -- a crumb with an empty name is worse than a shorter trail.
    await render(hits(0), '/en/search', { media: 'm1' });

    expect(crumbs().map((c) => c.name)).toEqual(['navbar.buttons.home', 'seo.media.title']);
  });

  test('the bare search page stops at the search crumb', async () => {
    await render(hits(0), '/en/search');

    expect(crumbs().map((c) => c.name)).toEqual(['navbar.buttons.home', 'seo.search.title']);
  });
});

describe('primed search error outcomes', () => {
  test('preserves an invalid request for hydration instead of flattening it to null', async () => {
    const outcome = { status: 'error', failure: { kind: 'invalid-request' } };
    const wrapper = await render(null, '/en/search/cat', {}, outcome);
    expect(wrapper.findComponent({ name: 'SearchContainer' }).props('initialSentenceOutcome')).toEqual(outcome);
  });

  test('preserves a stats-only failure separately from successful sentence data', async () => {
    fetchStats.mockResolvedValueOnce({ status: 'error', failure: { kind: 'unavailable' } });
    const wrapper = await render(hits(3));
    const container = wrapper.findComponent({ name: 'SearchContainer' });
    expect(container.props('initialSentenceOutcome').status).toBe('ok');
    expect(container.props('initialStatsOutcome')).toEqual({ status: 'error', failure: { kind: 'unavailable' } });
  });

  test('redirects a primed access denial from page setup', async () => {
    await render(null, '/en/search/cat', {}, { status: 'forbidden' });
    expect(navigateTo).toHaveBeenCalledWith('/en/', { redirectCode: 302 });
  });
});

test('recomputes media metadata when episode and locale change', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: {
      media: [
        {
          mediaPublicId: 'm1',
          matchCount: 1234,
          episodeHits: [
            { episode: 1, hitCount: 1200 },
            { episode: 3, hitCount: 34 },
          ],
        },
      ],
      categories: [],
    },
  });
  await render(
    { results: [{ segment: { publicId: 's1' }, media: { publicId: 'm1', nameEn: 'Bocchi' } }] },
    '/en/search',
    { media: 'm1' },
  );
  const metadata = useHead.mock.calls[0]?.[0];
  expect(unref(metadata)).toEqual(
    expectedMediaMeta('1,234 Japanese sentences from Bocchi across 2 episodes with English translations.'),
  );
  route.query.episode = '3';
  mediaMetaI18n.locale.value = 'es';
  expect(unref(metadata)).toEqual(
    expectedMediaMeta(
      'Frases en japonés del episodio 3 de «Bocchi»: 34. Consulta sus traducciones al español.',
      undefined,
      'es',
    ),
  );
});

test('keeps search defaults without first-result media and word metadata ahead of media metadata', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  await render(hits(0), '/en/search', { media: 'm1' });
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual({
    title: 'Search',
    meta: [
      {
        name: 'description',
        content:
          'Search over 1 million Japanese sentences with English translations from a wide variety of anime and J-dramas.',
      },
      { property: 'og:title', content: 'Search | Nadeshiko' },
      {
        property: 'og:description',
        content:
          'Search over 1 million Japanese sentences with English translations from a wide variety of anime and J-dramas.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'Search | Nadeshiko' },
      {
        name: 'twitter:description',
        content:
          'Search over 1 million Japanese sentences with English translations from a wide variety of anime and J-dramas.',
      },
    ],
  });
  useHead.mockClear();
  await render(hits(3), '/en/search/cat', { media: 'm1' });
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual({
    title: 'cat: Japanese example sentences',
    meta: [
      { name: 'description', content: '3 example sentences containing "cat" with English translations.' },
      { property: 'og:title', content: 'cat | Nadeshiko' },
      { property: 'og:description', content: '3 example sentences containing "cat" with English translations.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: 'cat | Nadeshiko' },
      { name: 'twitter:description', content: '3 example sentences containing "cat" with English translations.' },
    ],
  });
});

test('uses the first result artwork but the requested media stats, not scoped media or pagination', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useNadeshikoSdk', () => ({
    getMedia: vi
      .fn()
      .mockResolvedValue({ publicId: 'm1', nameEn: 'Other title', bannerUrl: 'https://images.test/other.webp' }),
  }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: {
      media: [
        { mediaPublicId: 'm2', matchCount: 99 },
        { mediaPublicId: 'm1', matchCount: 34 },
      ],
      categories: [],
    },
  });
  await render(
    {
      results: [
        {
          segment: { publicId: 's1' },
          media: { publicId: 'm2', nameEn: 'Bocchi', bannerUrl: 'https://images.test/banner.webp' },
        },
      ],
      pagination: { estimatedTotalHits: 100 },
    },
    '/en/search',
    { media: 'm1' },
  );
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual(
    expectedMediaMeta(
      '34 Japanese sentences from Bocchi with English translations.',
      'https://images.test/banner.webp',
    ),
  );
});

test.each([
  { label: 'NaN match count', mediaPublicId: 'm1', matchCount: Number.NaN },
  { label: 'missing matching stats', mediaPublicId: 'other', matchCount: 999999 },
])('uses zero for $label and ignores portrait covers', async ({ mediaPublicId, matchCount }) => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: { media: [{ mediaPublicId, matchCount }], categories: [] },
  });
  await render(
    {
      results: [
        {
          segment: { publicId: 's1' },
          media: { publicId: 'm1', nameEn: 'Bocchi', coverUrl: 'https://images.test/cover.webp' },
        },
      ],
    },
    '/en/search',
    { media: 'm1' },
  );
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual(
    expectedMediaMeta('0 Japanese sentences from Bocchi with English translations.'),
  );
});

/**
 * Page priming differs from the container: array `?query=` is joined, a category
 * slug is not validated, `episodeId` is an alias, and `preferMedia` is always present on the scope.
 * One baseline, plus the fields each gap changes.
 */
describe('route-to-scope priming', () => {
  const scopeBaseline = {
    query: '',
    category: 'all',
    mediaPublicId: null,
    episode: null,
    sort: null,
    randomSeed: null,
    segmentPublicId: null,
    collectionId: null,
    contentRating: ['SAFE'],
    languages: ['EN'],
    hiddenMediaExclude: [],
    hiddenCategories: [],
    preferMedia: [] as string[],
  };
  const wireBaseline = {
    query: undefined as { search: string } | undefined,
    take: 30,
    sort: undefined as { mode: string; seed?: number } | undefined,
    cursor: undefined,
    filters: { contentRating: ['SAFE'], languages: ['EN'] } as Record<string, unknown>,
    include: ['media'],
  };
  const forwarded = {
    status: 'ok',
    data: {
      results: [],
      pagination: { hasMore: false, cursor: '', estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT' },
    },
  };

  function probePage() {
    const sentenceScopes: unknown[] = [];
    const statsScopes: unknown[] = [];
    const asyncKeys: unknown[] = [];
    const fetcher = createSearchFetcher({ client: { id: 'page-scope' } } as never);
    vi.stubGlobal('useSearchFetch', () => ({
      fetchSentences: (scope: unknown) => {
        sentenceScopes.push(scope);
        return fetcher.fetchSentences(scope as never);
      },
      fetchStats: (scope: unknown) => {
        statsScopes.push(scope);
        return fetcher.fetchStats(scope as never);
      },
      cancelSentences: () => undefined,
      cancelStats: () => undefined,
    }));
    vi.stubGlobal('useAsyncData', async (key: unknown, handler: () => Promise<unknown>) => {
      asyncKeys.push(typeof key === 'function' ? (key as () => unknown)() : key);
      const data = ref(await handler());
      return { data, error: ref(null), refresh: vi.fn(), pending: ref(false) };
    });
    sdkHttp.search.mockResolvedValue({
      data: {
        segments: [],
        includes: { media: {} },
        pagination: forwarded.data.pagination,
      },
      response: new Response(),
    });
    sdkHttp.getSearchStats.mockResolvedValue({ data: { media: [], categories: [] }, response: new Response() });
    return { sentenceScopes, statsScopes, asyncKeys };
  }

  function signedIn(defaultCategory: string) {
    vi.stubGlobal('userStore', () => ({ isLoggedIn: true, userEmail: 'reader@example.test', preferences: {} }));
    vi.stubGlobal('useFavoriteMedia', () => ({ favoriteMediaIds: ref(new Set(['fav-1', 'fav-2'])) }));
    vi.stubGlobal('useFamiliarMedia', () => ({
      entries: ref([{ media: { publicId: 'fam-1' } }, { media: { publicId: 'fav-1' } }]),
      inferredRank: ref(new Map()),
      load: vi.fn(),
      forget: vi.fn(),
    }));
    vi.stubGlobal('useDefaultSearchCategory', () => ({
      storedDefault: ref(defaultCategory),
      defaultCategorySlug: ref(defaultCategory),
      isDefaultCategoryHidden: ref(false),
    }));
  }

  test.each([
    {
      label: 'array query, raw category, episodeId, and seed 0',
      path: '/en/search',
      query: {
        query: ['猫', '犬'],
        category: ['not-a-tab', 'anime'],
        episodeId: '7.5',
        mediaId: 'media-legacy',
        sort: 'random',
        seed: '0',
      },
      scope: {
        query: '猫,犬',
        category: 'not-a-tab',
        mediaPublicId: 'media-legacy',
        episode: 7.5,
        sort: 'random',
        randomSeed: 0,
      },
      wire: { query: { search: '猫,犬' }, sort: { mode: 'RANDOM', seed: 0 } },
      filters: { media: { include: [{ mediaPublicId: 'media-legacy', episodes: [7.5] }] } },
      sentenceKey: 'search-sentence-outcomes-猫,犬-not-a-tab-media-legacy-7.5-random',
      heading: '猫,犬' as string | false,
    },
    {
      label: 'preferMedia, a dropped seed, and the reader default category',
      path: '/en/search',
      query: { seed: '-1', episode: 'banana' },
      setup: () => signedIn('liveaction'),
      scope: { category: 'liveaction', preferMedia: ['fav-1', 'fav-2', 'fam-1'] },
      wire: { preferMedia: ['fav-1', 'fav-2', 'fam-1'] },
      filters: { category: ['JDRAMA'] },
      sentenceKey: 'search-sentence-outcomes-liveaction-banana',
      heading: false as string | false,
    },
    {
      label: 'a named title ignores the reader default category',
      path: '/en/search/cat',
      query: { media: 'm1' },
      setup: () =>
        vi.stubGlobal('useDefaultSearchCategory', () => ({
          storedDefault: ref('youtube'),
          defaultCategorySlug: ref('youtube'),
          isDefaultCategoryHidden: ref(false),
        })),
      scope: { query: 'cat', mediaPublicId: 'm1' },
      wire: { query: { search: 'cat' } },
      filters: { media: { include: [{ mediaPublicId: 'm1' }] } },
      sentenceKey: 'search-sentence-outcomes-cat-all-m1',
      heading: 'cat' as string | false,
    },
  ])('$label', async ({ path, query, setup, scope, wire, filters, sentenceKey, heading }) => {
    setup?.();
    const probe = probePage();
    const wrapper = await render(null, path, query);
    const expectedScope = { ...scopeBaseline, ...scope };
    expect(probe.sentenceScopes).toEqual([expectedScope]);
    expect(probe.statsScopes).toEqual([expectedScope]);
    expect(probe.asyncKeys[0]).toBe(sentenceKey);
    expect(sdkHttp.search.mock.calls.map((call) => call[0].body)).toEqual([
      { ...wireBaseline, ...wire, filters: { ...wireBaseline.filters, ...filters } },
    ]);
    expect(wrapper.findComponent({ name: 'SearchContainer' }).props('initialSentenceOutcome')).toEqual(forwarded);
    if (heading === false) expect(wrapper.find('h1').exists()).toBe(false);
    else expect(wrapper.find('h1').text()).toBe(heading);
  });
});
