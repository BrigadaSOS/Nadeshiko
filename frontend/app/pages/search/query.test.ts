// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref, unref } from 'vue';
import { createHead, renderSSRHead } from 'unhead/server';
import {
  mediaMetaCases,
  mediaMetaI18n,
  formatMediaMetaNumber,
  expectedMediaMeta,
  expectedFallbackHead,
} from '../../../test/media-meta-fixtures';

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
  contentRating: ref('SAFE'),
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
vi.stubGlobal('useSearchFetch', () => ({
  fetchSentences: vi.fn().mockImplementation(async () => sentenceOutcome.value),
  fetchStats,
  cancelSentences: vi.fn(),
  cancelStats: vi.fn(),
}));
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

vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
  const data = ref(await handler());
  return { data, error: ref(null), refresh: vi.fn(), pending: ref(false) };
});

import { getStringQueryValue, decodeSearchQuery } from '~/utils/routes';
vi.stubGlobal('getStringQueryValue', getStringQueryValue);
vi.stubGlobal('decodeSearchQuery', decodeSearchQuery);

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

describe('media browse metadata', () => {
  test.each(mediaMetaCases)('$label', async ({ stats, episode, bannerUrl, locale, description }) => {
    mediaMetaI18n.locale.value = locale ?? 'en';
    vi.stubGlobal('useI18n', () => mediaMetaI18n);
    vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
    fetchStats.mockResolvedValueOnce({
      status: 'ok',
      data: {
        media: [
          { mediaPublicId: 'other', matchCount: 999999, episodeHits: [{ episode: 3, hitCount: 999999 }] },
          ...(stats ? [{ mediaPublicId: 'm1', ...stats }] : []),
        ],
        categories: [],
      },
    });
    await render(
      {
        results: [
          {
            segment: { publicId: 's1' },
            media: { publicId: 'm1', nameEn: 'Bocchi', bannerUrl, coverUrl: 'https://images.test/cover.webp' },
          },
        ],
        pagination: { estimatedTotalHits: 999999 },
      },
      '/en/search',
      { media: 'm1', ...(episode !== undefined ? { episode } : {}) },
    );
    expect(unref(useHead.mock.calls[0]?.[0])).toEqual(expectedMediaMeta(description, bannerUrl, locale));
  });
});

test('renders the complete fallback head with the site title template', async () => {
  mediaMetaI18n.locale.value = 'en';
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: { media: [{ mediaPublicId: 'm1', matchCount: 1234 }], categories: [] },
  });
  await render(
    { results: [{ segment: { publicId: 's1' }, media: { publicId: 'm1', nameEn: 'Bocchi' } }] },
    '/en/search',
    { media: 'm1' },
  );
  const head = createHead();
  head.push({ titleTemplate: '%s | Nadeshiko' });
  head.push(unref(useHead.mock.calls[0]?.[0]));
  expect((await renderSSRHead(head)).headTags).toBe(expectedFallbackHead);
});

test('recomputes media metadata when episode and locale change', async () => {
  mediaMetaI18n.locale.value = 'en';
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
  mediaMetaI18n.locale.value = 'en';
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
  mediaMetaI18n.locale.value = 'en';
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
        { mediaPublicId: 'm1', matchCount: 34 },
        { mediaPublicId: 'm2', matchCount: 99 },
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

test('retains this caller’s non-finite match-count fallback', async () => {
  mediaMetaI18n.locale.value = 'en';
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: { media: [{ mediaPublicId: 'm1', matchCount: Number.NaN }], categories: [] },
  });
  await render(
    { results: [{ segment: { publicId: 's1' }, media: { publicId: 'm1', nameEn: 'Bocchi' } }] },
    '/en/search',
    { media: 'm1' },
  );
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual(
    expectedMediaMeta('0 Japanese sentences from Bocchi with English translations.'),
  );
});
