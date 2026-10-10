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
const fetchSentences = vi.fn();
const fetchStats = vi.fn();
vi.stubGlobal('useSearchFetch', () => ({
  fetchSentences,
  fetchStats,
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
        SearchBaseInputSegment: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
        NuxtImg: true,
        UiBaseIcon: true,
        MediaHeader: true,
        SearchContainer: {
          name: 'SearchContainer',
          props: ['initialSentenceOutcome', 'initialStatsOutcome'],
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
    route.query = episode !== undefined ? { episode } : {};
    await render(media({ nameEn: 'Bocchi', bannerUrl, coverUrl: 'https://images.test/cover.webp' }));
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
  await render(media({ nameEn: 'Bocchi' }));
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
  await render(media({ nameEn: 'Bocchi' }));
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

test('retains this caller’s non-finite match-count fallback', async () => {
  mediaMetaI18n.locale.value = 'en';
  vi.stubGlobal('useI18n', () => mediaMetaI18n);
  vi.stubGlobal('useFormat', () => ({ formatNumber: formatMediaMetaNumber }));
  fetchStats.mockResolvedValueOnce({
    status: 'ok',
    data: { media: [{ mediaPublicId: 'm1', matchCount: Number.NaN }], categories: [] },
  });
  await render(media({ nameEn: 'Bocchi' }));
  expect(unref(useHead.mock.calls[0]?.[0])).toEqual(
    expectedMediaMeta(' Japanese sentences from Bocchi with English translations.'),
  );
});

test('recomputes the title and descriptions when the preferred media-name language changes', async () => {
  mediaMetaI18n.locale.value = 'en';
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
