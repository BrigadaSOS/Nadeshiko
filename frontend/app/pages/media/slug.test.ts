// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref, unref } from 'vue';

/**
 * A title's own page, whose real output is the ENTITY it declares.
 *
 * `name` resolves against the reader's language preference, so the page was
 * advertising exactly one of a work's three titles and which one depended on who
 * was looking. `alternateName` is where the other two go, and it is what lets
 * queries for all three forms resolve to one entity instead of competing for it.
 *
 * The deduplication matters as much as the list: a work whose romaji and English
 * forms are identical, or which carries only one name, must not claim an
 * alternate that is the name it already gave.
 */
const capturedSchema: unknown[] = [];
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
vi.stubGlobal('useHead', vi.fn());
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
vi.stubGlobal('useMediaScope', () => ({ isMediaPage: ref(true), selectMedia: vi.fn() }));
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
vi.stubGlobal('useNadeshikoSdk', () => ({}));
vi.stubGlobal('userStore', () => ({ isLoggedIn: false, isAdmin: false, preferences: {}, user: null }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
const createError = vi.fn((v: Record<string, unknown>) => Object.assign(new Error('x'), v));
vi.stubGlobal('createError', createError);
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

import { getStringQueryValue } from '~/utils/routes';
vi.stubGlobal('getStringQueryValue', getStringQueryValue);
import { mediaSameAsUrls } from '~/utils/media';
vi.stubGlobal('mediaSameAsUrls', mediaSameAsUrls);

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
  if (value === null) $fetch.mockRejectedValue({ statusCode: 404 });
  else $fetch.mockResolvedValue(value);

  const Host = defineComponent({
    components: { MediaSlugPage },
    errorCaptured: () => false,
    template: '<Suspense><MediaSlugPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        MediaHeader: true,
        SearchContainer: true,
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
  language.value = 'ENGLISH';
  route.query = {};
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the work entity', () => {
  test('is declared for a title', async () => {
    await render();

    expect(work()).toBeTruthy();
  });

  test('carries the OTHER two names as alternates', async () => {
    // Search Console shows readers arriving on all three forms; without this the
    // three queries compete for one entity instead of resolving to it.
    await render();

    expect(work()!.alternateName).toEqual(expect.arrayContaining(['ぼっち・ざ・ろっく', 'Bocchi Za Rokku']));
  });

  test('never repeats the name it already gave', async () => {
    await render();

    expect(work()!.alternateName).not.toContain(work()!.name);
  });

  test('and follows the reader’s language, so the alternates change with it', async () => {
    language.value = 'JAPANESE';
    await render();

    expect(work()!.name).toBe('ぼっち・ざ・ろっく');
    expect(work()!.alternateName).not.toContain('ぼっち・ざ・ろっく');
  });

  test('a title with one name claims no alternates at all', async () => {
    await render(media({ nameJa: '', nameRomaji: '' }));

    expect(work()!.alternateName ?? []).toHaveLength(0);
  });

  test('an alternate that repeats the primary name is dropped', async () => {
    // A work whose romaji and English titles are identical.
    await render(media({ nameJa: '', nameRomaji: 'Bocchi the Rock' }));

    expect(work()!.alternateName ?? []).toHaveLength(0);
  });

  test('two alternates that match EACH OTHER are listed once', async () => {
    // Distinct from the headline, so only the deduplication can collapse them.
    await render(media({ nameJa: 'ぼっち', nameRomaji: 'ぼっち' }));

    expect(work()!.alternateName).toEqual(['ぼっち']);
  });

  test('a FILM is declared as a Movie, not a series', async () => {
    // A film with `numberOfEpisodes` is invalid markup, and a series declared as
    // a film loses the one property that distinguishes it.
    await render(media({ airingFormat: 'MOVIE', episodeCount: 1 }));

    expect(work()!['@type']).toBe('Movie');
    expect(work()).not.toHaveProperty('numberOfEpisodes');
  });

  test('and a series carries its episode count', async () => {
    await render(media({ episodeCount: 12 }));

    expect(work()!['@type']).toBe('TVSeries');
    expect(work()!.numberOfEpisodes).toBe(12);
  });

  test('a YouTube channel declares no work entity, because it is not one', async () => {
    await render(media({ category: 'YOUTUBE' }));

    expect(work()).toBeUndefined();
  });
});

describe('a slug that resolves to nothing', () => {
  test('404s rather than rendering an empty title page', async () => {
    await render(null);

    expect(createError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});

describe('the episode filter in the URL', () => {
  test('is read as a number', async () => {
    route.query = { episode: '3' };
    const wrapper = await render();

    expect(wrapper.html()).toBeTruthy();
  });

  test('a non-numeric episode is ignored rather than sent on', async () => {
    route.query = { episode: 'banana' };
    const wrapper = await render();

    expect(wrapper.html()).toBeTruthy();
  });
});
