// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { reactive, ref } from 'vue';

/**
 * The search results page: the payload the sidebar and the cards are both built
 * from.
 *
 * What is pinned here is the COMPOSITION -- how the reader's hidden titles and
 * hidden categories are subtracted from the stats before anything renders. The
 * arithmetic itself lives in `~/utils/hiddenResults` and `~/utils/categories`
 * and is unit tested there; what cannot be tested there is the assembly, which
 * is where the two exceptions live: `revealHidden` lifts everything at once, and
 * the category the reader is CURRENTLY looking at survives being hidden, because
 * a selected tab that renders nowhere is worse than a tab they chose to open.
 */
vi.mock('~/utils/apiError', () => ({ handleApiError: vi.fn(), apiErrorStatus: () => null }));
vi.mock('~/utils/reportError', () => ({ reportError: vi.fn() }));

const route = reactive({ path: '/search/word', params: { query: 'word' }, query: {} as Record<string, unknown> });
const hiddenMediaIds = ref<string[]>([]);
const hiddenCategories = ref<string[]>([]);
const fetchSentences = vi.fn();
const fetchStats = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push: vi.fn(), replace: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useNadeshikoSdk', () => ({}));
vi.stubGlobal('useEventListener', vi.fn());
vi.stubGlobal('onBeforeRouteUpdate', vi.fn());
vi.stubGlobal('onBeforeRouteLeave', vi.fn());
vi.stubGlobal('useContentRating', () => ({
  shouldBlur: () => false,
  isRestricted: () => false,
  contentRating: ref('SAFE'),
  preferences: ref({}),
}));
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m.nameEn ?? '',
  language: ref('ENGLISH'),
}));
vi.stubGlobal('useTranslationVisibility', () => ({
  englishMode: ref('visible'),
  spanishMode: ref('visible'),
  includedLanguages: ref(['EN', 'ES']),
  setEnglishMode: vi.fn(),
  setSpanishMode: vi.fn(),
}));
vi.stubGlobal('useDefaultSearchCategory', () => ({
  storedDefault: ref('all'),
  defaultCategorySlug: ref('all'),
  isDefaultCategoryHidden: ref(false),
}));
vi.stubGlobal('useHiddenMedia', () => ({
  hiddenMediaIds,
  hiddenMediaExcludeFilter: ref([]),
  isMediaHidden: (id: string) => hiddenMediaIds.value.includes(id),
  toggleHideMedia: vi.fn(),
}));
vi.stubGlobal('useHiddenCategories', () => ({
  hiddenCategories,
  hasHiddenCategories: ref(false),
  isCategoryHidden: (c: string) => hiddenCategories.value.includes(c),
}));
vi.stubGlobal('useSearchFetch', () => ({
  fetchSentences,
  fetchStats,
  cancelSentences: vi.fn(),
  cancelStats: vi.fn(),
}));
vi.stubGlobal('useSearchRecents', () => ({
  recents: ref([]),
  loading: ref(false),
  clearing: ref(false),
  isRecording: ref(false),
  load: vi.fn(),
  remember: vi.fn(),
  forget: vi.fn(),
  clear: vi.fn(),
  narrow: vi.fn(),
}));
vi.stubGlobal('useSignupNudge', () => ({
  nudgeAfterDownload: vi.fn(),
  nudgeAfterAnkiMenu: vi.fn(),
  nudgeAfterSearch: vi.fn(),
  recordSearch: vi.fn(),
}));

import { getStringQueryValue } from '~/utils/routes';
// Auto-imported route helpers, real rather than faked.
vi.stubGlobal('getStringQueryValue', getStringQueryValue);

import SearchContainer from './SearchContainer.vue';

const mediaRow = (id: string, over: Record<string, unknown> = {}) => ({
  mediaPublicId: id,
  nameEn: id,
  nameJa: '',
  nameRomaji: '',
  matchCount: 5,
  category: 'ANIME',
  airingFormat: 'TV',
  episodeHits: [],
  ...over,
});

const categoryRow = (category: string, count: number) => ({ category, count });

const mounted: { unmount: () => void }[] = [];

/** Renders the sidebar's filter list, which is where `searchData.media` shows. */
const FilterStub = {
  props: ['searchData'],
  template: `<div><span v-for="m in (searchData?.media ?? [])" :key="m.mediaPublicId"
    class="fm">{{ m.mediaPublicId }}</span>
    <span v-for="c in (searchData?.categories ?? [])" :key="c.category" class="fc">{{ c.category }}:{{ c.count }}</span></div>`,
};

function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(SearchContainer, {
    props: {
      initialSentenceData: { results: [], pagination: { cursor: null, hasMore: false } },
      initialStatsData: { media: [], categories: [] },
      ...props,
    } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchSegmentFilterContent: FilterStub,
        SearchSegmentSidebar: FilterStub,
        SearchSegmentContainer: true,
        SearchSegmentFilterSortContent: true,
        SearchResultControls: true,
        SearchHiddenResultsNotice: {
          props: ['count', 'revealed'],
          emits: ['reveal', 'restore'],
          template: `<div data-testid="hidden-notice">{{ count }}
            <button data-act="reveal" @click="$emit('reveal')">r</button>
            <button data-act="restore" @click="$emit('restore')">x</button></div>`,
        },
        CommonInfiniteScrollObserver: true,
        CommonTabsContainer: { template: '<div><slot /></div>' },
        CommonTabsHeader: { template: '<div><slot /></div>' },
        CommonTabsItem: { template: '<div><slot /></div>' },
        UiBaseIcon: true,
        UiButtonPrimaryAction: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The media ids the sidebar was handed. */
const sidebarMedia = (w: ReturnType<typeof render>) => [...new Set(w.findAll('.fm').map((n) => n.text()))];
/** The category buckets the sidebar was handed, as `NAME:count`. */
const sidebarCategories = (w: ReturnType<typeof render>) => [...new Set(w.findAll('.fc').map((n) => n.text()))];

beforeEach(() => {
  vi.clearAllMocks();
  hiddenMediaIds.value = [];
  hiddenCategories.value = [];
  route.query = {};
  route.path = '/search/word';
  fetchSentences.mockResolvedValue({ results: [], pagination: { cursor: null, hasMore: false } });
  fetchStats.mockResolvedValue({ media: [], categories: [] });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the media list the sidebar is built from', () => {
  test('carries every title when the reader hides nothing', async () => {
    const wrapper = render({ initialStatsData: { media: [mediaRow('a'), mediaRow('b')], categories: [] } });
    await flushPromises();

    expect(sidebarMedia(wrapper)).toEqual(['a', 'b']);
  });

  test('drops a hidden title before the sidebar ever sees it', async () => {
    hiddenMediaIds.value = ['b'];
    const wrapper = render({ initialStatsData: { media: [mediaRow('a'), mediaRow('b')], categories: [] } });
    await flushPromises();

    expect(sidebarMedia(wrapper)).toEqual(['a']);
  });

  // NOT covered here: lifting the filters through the notice. `revealHidden` is
  // reached by pressing a control that only renders inside the results area,
  // which needs far more of the page stood up than these assertions do -- and a
  // test that reached past the UI to set the flag would be asserting against my
  // own harness rather than against anything a reader can do. The e2e suite
  // drives that path in a real browser; what is pinned here is the composition
  // the flag feeds into.
});

describe('the category tabs', () => {
  test('keeps every bucket the server sent when nothing is hidden', async () => {
    const wrapper = render({
      initialStatsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toEqual(['ANIME:10', 'YOUTUBE:4']);
  });

  test('drops a hidden category’s tab entirely', async () => {
    hiddenCategories.value = ['YOUTUBE'];
    const wrapper = render({
      initialStatsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toEqual(['ANIME:10']);
  });

  test('but KEEPS the one the reader is currently looking at', async () => {
    // `?category=` overrides the hidden list, and a selected tab that renders
    // nowhere is worse than a tab they chose to open.
    hiddenCategories.value = ['YOUTUBE'];
    route.query = { category: 'youtube' };
    const wrapper = render({
      initialStatsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toContain('YOUTUBE:4');
  });

  test('a hidden TITLE is discounted from its category’s count, not just the list', async () => {
    // The server aggregates before the reader's list is applied, so leaving the
    // count alone advertises results the page will not show.
    hiddenMediaIds.value = ['b'];
    const wrapper = render({
      initialStatsData: {
        media: [mediaRow('a', { matchCount: 6 }), mediaRow('b', { matchCount: 4 })],
        categories: [categoryRow('ANIME', 10)],
      },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toEqual(['ANIME:6']);
  });
});
