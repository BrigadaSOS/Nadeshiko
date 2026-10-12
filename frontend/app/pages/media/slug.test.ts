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

// Work aliases expose language variants independently of the displayed title preference.
// Exclude the displayed name and duplicate aliases.
const capturedSchema: unknown[] = [];
const capturedErrors: unknown[] = [];
const route = reactive({
  params: { slug: 'bocchi' },
  path: '/media/bocchi',
  query: {} as Record<string, unknown>,
  fullPath: '/media/bocchi',
});
const $fetch = vi.fn();
const language = ref<'ENGLISH' | 'JAPANESE' | 'ROMAJI'>('ENGLISH');

vi.stubGlobal('$fetch', $fetch);
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/media/bocchi'));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
const useHead = vi.fn();
vi.stubGlobal('useHead', useHead);
vi.stubGlobal('useSchemaOrg', (v: unknown) => capturedSchema.push(v));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('defineWebPage', (v: Record<string, unknown>) => ({ '@type': 'WebPage', ...v }));
vi.stubGlobal('defineBreadcrumb', (v: Record<string, unknown>) => ({ '@type': 'BreadcrumbList', ...v }));
vi.stubGlobal('defineMovie', (v: Record<string, unknown>) => ({ '@type': 'Movie', ...v }));
vi.stubGlobal('defineTVSeries', (v: Record<string, unknown>) => ({ '@type': 'TVSeries', ...v }));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) =>
    language.value === 'JAPANESE'
      ? m.nameJa || m.nameEn
      : language.value === 'ROMAJI'
        ? m.nameRomaji || m.nameEn
        : m.nameEn,
  language,
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
vi.stubGlobal('useMediaScope', () => ({ isMediaPage: ref(true), selectMedia: vi.fn() }));
vi.stubGlobal('useTranslationVisibility', () => ({
  englishMode: ref('visible'),
  spanishMode: ref('visible'),
  includedLanguages: ref(['EN']),
}));
vi.stubGlobal('useTranslationLanguages', () => ({ languages: ref(['EN']), dictionaryGlossLanguages: ref(['en']) }));
const fetchSentences = vi.fn();
const fetchStats = vi.fn();
function stubPrimedSearchFetch() {
  vi.stubGlobal('useSearchFetch', () => ({
    fetchSentences,
    fetchStats,
    cancelSentences: vi.fn(),
    cancelStats: vi.fn(),
  }));
}
stubPrimedSearchFetch();
vi.stubGlobal('useNadeshikoSdk', () => ({}));
vi.stubGlobal('userStore', () => ({ isLoggedIn: false, isAdmin: false, preferences: {}, user: null }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
vi.stubGlobal('createError', (v: Record<string, unknown>) => Object.assign(new Error('x'), v));
function stubPrimedAsyncData() {
  vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
    const data = ref<unknown>(null);
    const error = ref<unknown>(null);
    try {
      data.value = await handler();
    } catch (e) {
      error.value = e;
    }
    return { data, error, refresh: vi.fn(), pending: ref(false) };
  });
}
stubPrimedAsyncData();

import { createSearchFetcher } from '~/composables/useSearchFetch';

import MediaSlugPage from './[slug].vue';

function media(over: Record<string, unknown> = {}) {
  return {
    publicId: 'm1',
    slug: 'bocchi',
    nameEn: 'Bocchi the Rock',
    nameJa: 'ぼっち・ざ・ろっく',
    nameRomaji: 'Bocchi Za Rokku',
    category: 'ANIME',
    airingFormat: 'TV',
    genres: ['Comedy'],
    externalIds: {},
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(value: Record<string, unknown> | null = media()) {
  capturedSchema.length = 0;
  capturedErrors.length = 0;
  if (value === null) $fetch.mockRejectedValue({ statusCode: 404 });
  else $fetch.mockResolvedValue(value);

  const Host = defineComponent({
    components: { MediaSlugPage },
    errorCaptured: (error: unknown) => {
      capturedErrors.push(error);
      return false;
    },
    template: '<Suspense><MediaSlugPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchBaseInputSegment: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        MediaHeader: true,
        SearchContainer: {
          name: 'SearchContainer',
          props: ['initialSentenceOutcome', 'initialStatsOutcome', 'mediaPublicId'],
          template: '<div />',
        },
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const nodes = (): Record<string, unknown>[] =>
  capturedSchema.flatMap((entry) => (unref(entry) as Record<string, unknown>[]) ?? []);
/** The work entity, by its actual type -- the page node carries an overridden
 *  `@type` of its own (`CollectionPage`), so "not WebPage" catches the wrong one. */
const work = () => nodes().find((n) => n['@type'] === 'Movie' || n['@type'] === 'TVSeries');

beforeEach(() => {
  vi.clearAllMocks();
  mediaMetaI18n.locale.value = 'en';
  sdkHttp.search.mockReset();
  sdkHttp.getSearchStats.mockReset();
  stubPrimedSearchFetch();
  stubPrimedAsyncData();
  vi.stubGlobal('userStore', () => ({ isLoggedIn: false, isAdmin: false, preferences: {}, user: null }));
  vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
  vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
  fetchSentences.mockResolvedValue({ status: 'ok', data: { results: [], pagination: {} } });
  fetchStats.mockResolvedValue({ status: 'ok', data: { media: [], categories: [] } });
  language.value = 'ENGLISH';
  route.query = {};
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the work entity', () => {
  const series = { '@type': 'TVSeries', name: 'Bocchi the Rock', genre: ['Comedy'], inLanguage: 'ja' };
  const alternates = ['ぼっち・ざ・ろっく', 'Bocchi Za Rokku'];
  test.each([
    {
      label: 'other names exclude the primary name',
      input: {},
      expected: { ...series, alternateName: alternates },
    },
    {
      label: 'alternates follow the reader language',
      input: {},
      language: 'JAPANESE' as const,
      expected: { ...series, name: 'ぼっち・ざ・ろっく', alternateName: ['Bocchi Za Rokku', 'Bocchi the Rock'] },
    },
    {
      label: 'blank names are omitted',
      input: { nameJa: '', nameRomaji: '' },
      expected: series,
    },
    {
      label: 'a repeated primary name is omitted',
      input: { nameJa: '', nameRomaji: 'Bocchi the Rock' },
      expected: series,
    },
    {
      label: 'duplicate alternates are emitted once',
      input: { nameJa: 'ぼっち', nameRomaji: 'ぼっち' },
      expected: { ...series, alternateName: ['ぼっち'] },
    },
    {
      label: 'a film is a Movie without an episode count',
      input: { airingFormat: 'MOVIE', episodeCount: 1 },
      expected: { ...series, '@type': 'Movie', alternateName: alternates },
    },
    {
      label: 'a series carries its episode count',
      input: { episodeCount: 12 },
      expected: { ...series, alternateName: alternates, numberOfEpisodes: 12 },
    },
  ])('$label', async ({ input, language: preference, expected }) => {
    language.value = preference ?? 'ENGLISH';
    await render(media(input));
    expect(work()).toEqual(expected);
  });

  test('a YouTube channel emits page and breadcrumb schema without a work entity', async () => {
    await render(media({ category: 'YOUTUBE' }));

    expect(nodes()).toEqual([
      { '@type': 'CollectionPage' },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { name: 'navbar.buttons.home', item: '/' },
          { name: 'seo.media.title', item: '/media' },
          { name: 'Bocchi the Rock', item: '/media/bocchi' },
        ],
      },
    ]);
  });
});

test('a missing slug propagates Media Not Found from page setup', async () => {
  await render(null);

  expect(capturedErrors).toEqual([expect.objectContaining({ statusCode: 404, statusMessage: 'Media Not Found' })]);
});

describe('primed media search errors', () => {
  test('preserves a failed sentence outcome for hydration', async () => {
    const outcome = { status: 'error', failure: { kind: 'unavailable' } };
    fetchSentences.mockResolvedValueOnce(outcome);
    const wrapper = await render();
    expect(wrapper.findComponent({ name: 'SearchContainer' }).props('initialSentenceOutcome')).toEqual(outcome);
  });

  test('preserves a stats-only failure alongside successful sentence data', async () => {
    fetchStats.mockResolvedValueOnce({ status: 'error', failure: { kind: 'unavailable' } });
    const wrapper = await render();
    const container = wrapper.findComponent({ name: 'SearchContainer' });
    expect(container.props('initialSentenceOutcome').status).toBe('ok');
    expect(container.props('initialStatsOutcome')).toEqual({ status: 'error', failure: { kind: 'unavailable' } });
  });
});

test('recomputes media metadata when episode and locale change', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: {
      media: [
        { mediaPublicId: 'other', matchCount: 999999, episodeHits: [{ episode: 3, hitCount: 999999 }] },
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
  await render(media({ nameEn: 'Bocchi', bannerUrl: 'https://images.test/banner.webp' }));
  const metadata = useHead.mock.calls[0]?.[0];
  expect(unref(metadata)).toEqual(
    expectedMediaMeta(
      '1,234 Japanese sentences from Bocchi across 2 episodes with English translations.',
      'https://images.test/banner.webp',
    ),
  );
  route.query.episode = '3';
  mediaMetaI18n.locale.value = 'es';
  expect(unref(metadata)).toEqual(
    expectedMediaMeta(
      'Frases en japonés del episodio 3 de «Bocchi»: 34. Consulta sus traducciones al español.',
      'https://images.test/banner.webp',
      'es',
    ),
  );
});

test('retains this caller’s NaN match-count fallback', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: { media: [{ mediaPublicId: 'm1', matchCount: Number.NaN }], categories: [] },
  });
  await render(media({ nameEn: 'Bocchi', coverUrl: 'https://images.test/cover.webp' }));
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual(
    expectedMediaMeta(' Japanese sentences from Bocchi with English translations.'),
  );
});

test('recomputes the title and descriptions when the preferred media-name language changes', async () => {
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  await render(media({ nameEn: 'Bocchi' }));
  const metadata = useHead.mock.calls[0]?.[0];
  expect(unref(metadata)).toEqual(expectedMediaMeta('0 Japanese sentences from Bocchi with English translations.'));
  language.value = 'JAPANESE';
  const updated = unref(metadata);
  expect({ title: updated.title, description: updated.meta[0].content, social: updated.meta[1].content }).toEqual({
    title: 'ぼっち・ざ・ろっく: Japanese subtitles and example sentences',
    description: '0 Japanese sentences from ぼっち・ざ・ろっく with English translations.',
    social: 'ぼっち・ざ・ろっく | Nadeshiko',
  });
});

/**
 * The title page keeps its own route policy. `episodeId`,
 * `?seed=`, and `?query=` are ignored, and `preferMedia` is omitted.
 */
describe('route-to-scope priming', () => {
  const scopeBaseline = {
    query: '',
    category: 'all',
    mediaPublicId: 'm1',
    episode: null,
    sort: null,
    randomSeed: null,
    segmentPublicId: null,
    collectionId: null,
    contentRating: ['SAFE'],
    languages: ['EN'],
    hiddenMediaExclude: [],
    hiddenCategories: [],
  };
  const wireBaseline = {
    query: undefined as { search: string } | undefined,
    take: 30,
    sort: undefined as { mode: string; seed?: number } | undefined,
    cursor: undefined,
    filters: {
      contentRating: ['SAFE'],
      languages: ['EN'],
      media: { include: [{ mediaPublicId: 'm1' }] },
    } as Record<string, unknown>,
    include: ['media'],
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
      const data = ref<unknown>(null);
      const error = ref<unknown>(null);
      try {
        data.value = await handler();
      } catch (e) {
        error.value = e;
      }
      return { data, error, refresh: vi.fn(), pending: ref(false) };
    });
    sdkHttp.search.mockResolvedValue({
      data: {
        segments: [],
        includes: { media: {} },
        pagination: { hasMore: false, cursor: '', estimatedTotalHits: 0, estimatedTotalHitsRelation: 'EXACT' },
      },
      response: new Response(),
    });
    sdkHttp.getSearchStats.mockResolvedValue({ data: { media: [], categories: [] }, response: new Response() });
    return { sentenceScopes, statsScopes, asyncKeys };
  }

  test.each([
    {
      label: 'ignores episodeId, seed, and the query string, and omits preferMedia',
      query: {
        query: ['猫', '犬'],
        category: ['not-a-tab', 'anime'],
        episodeId: '9',
        seed: '12',
        sort: 'random',
        media: 'other-id',
        uuid: 'seg-legacy',
      },
      scope: { category: 'not-a-tab', sort: 'random' },
      wire: { sort: { mode: 'RANDOM' } },
      filters: {},
      sentenceKey: 'media-sentence-outcomes-bocchi-all',
    },
    {
      label: 'sends a non-integer episode and keeps an absent category at all',
      query: { episode: '3.5', seed: '4' },
      scope: { episode: 3.5 },
      wire: {},
      filters: { media: { include: [{ mediaPublicId: 'm1', episodes: [3.5] }] } },
      sentenceKey: 'media-sentence-outcomes-bocchi-3.5',
    },
    {
      label: 'ignores a non-numeric episode',
      query: { episode: 'banana' },
      scope: {},
      wire: {},
      filters: {},
      sentenceKey: 'media-sentence-outcomes-bocchi-all',
    },
  ])('$label', async ({ query, scope, wire, filters, sentenceKey }) => {
    vi.stubGlobal('userStore', () => ({
      isLoggedIn: true,
      isAdmin: false,
      preferences: {},
      user: null,
      userEmail: 'reader@example.test',
    }));
    vi.stubGlobal('useFavoriteMedia', () => ({ favoriteMediaIds: ref(new Set(['fav-1'])) }));
    vi.stubGlobal('useDefaultSearchCategory', () => ({
      storedDefault: ref('youtube'),
      defaultCategorySlug: ref('youtube'),
      isDefaultCategoryHidden: ref(false),
    }));
    const probe = probePage();
    route.query = query;
    const wrapper = await render();
    const expectedScope = { ...scopeBaseline, ...scope };
    expect(probe.sentenceScopes).toEqual([expectedScope]);
    expect(probe.statsScopes).toEqual([expectedScope]);
    expect(probe.asyncKeys[1]).toBe(sentenceKey);
    expect(sdkHttp.search.mock.calls.map((call) => call[0].body)).toEqual([
      { ...wireBaseline, ...wire, filters: { ...wireBaseline.filters, ...filters } },
    ]);
    expect(wrapper.findComponent({ name: 'SearchContainer' }).props('mediaPublicId')).toBe('m1');
  });
});
