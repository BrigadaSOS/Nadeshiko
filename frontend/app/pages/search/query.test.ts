// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref, unref } from 'vue';

/**
 * The search page, whose interesting output is what it tells CRAWLERS.
 *
 * `noindex` on a thin page is right; `noindex` on a page whose fetch merely
 * failed is a backend blip de-indexing good pages wholesale, which is far more
 * expensive than briefly indexing a thin one. The two arrive here looking almost
 * identical -- no results either way -- and only `data == null` separates them.
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
const sentenceData = ref<Record<string, unknown> | null>(null);

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/en/search/cat'));
vi.stubGlobal('useRequestTraffic', () => ({ isCrawler: false }));
vi.stubGlobal('useRobotsRule', (v: unknown) => capturedRobots.push(v));
vi.stubGlobal('useHead', vi.fn());
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
  fetchSentences: vi.fn().mockResolvedValue({ results: [], pagination: {} }),
  fetchStats: vi.fn().mockResolvedValue({ media: [], categories: [] }),
  cancelSentences: vi.fn(),
  cancelStats: vi.fn(),
}));
// `getMedia` included: the page resolves a `?media=` scope through it, and an
// SDK stub without it sends that straight to the failure path -- where the
// breadcrumb's title never resolves and the assertion about it means nothing.
vi.stubGlobal('useNadeshikoSdk', () => ({
  getMedia: vi.fn().mockResolvedValue({ publicId: 'm1', nameEn: 'Bocchi', slug: 'bocchi' }),
}));
vi.stubGlobal('userStore', () => ({ isLoggedIn: false, userEmail: null, preferences: {} }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
vi.stubGlobal(
  'createError',
  vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v)),
);

/** Only the SENTENCE fetch varies per test; the rest resolve empty. */
let asyncCall = 0;
vi.stubGlobal('useAsyncData', async (_k: unknown, handler: () => Promise<unknown>) => {
  const index = asyncCall++;
  const data = ref<unknown>(null);
  if (index === 0) data.value = sentenceData.value;
  else {
    try {
      data.value = await handler();
    } catch {
      data.value = null;
    }
  }
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
) {
  capturedRobots.length = 0;
  capturedSchema.length = 0;
  asyncCall = 0;
  sentenceData.value = sentences;
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
      stubs: { SearchContainer: true, NuxtLink: { props: ['to'], template: '<a><slot /></a>' }, UiBaseIcon: true },
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
    // The expensive mistake: `null` means the fetch fell over, and treating it
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
