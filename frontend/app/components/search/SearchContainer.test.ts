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
vi.mock('~/stores/player', () => ({ usePlayerStore: () => ({ hidePlayer: vi.fn() }) }));
vi.mock('~/utils/apiError', () => ({ handleApiError: vi.fn(), apiErrorStatus: () => null }));
vi.mock('~/utils/reportError', () => ({ reportError: vi.fn() }));

const route = reactive({ path: '/search/word', params: { query: 'word' }, query: {} as Record<string, unknown> });
const hiddenMediaIds = ref<string[]>([]);
const hiddenCategories = ref<string[]>([]);
const fetchSentences = vi.fn();
const fetchStats = vi.fn();
const navigateTo = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('navigateTo', navigateTo);
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

function render({
  sentenceData = { results: [], pagination: { cursor: null, hasMore: false } },
  statsData = { media: [], categories: [] },
  ...props
}: Record<string, unknown> = {}) {
  const wrapper = mount(SearchContainer, {
    props: {
      initialSentenceOutcome: { status: 'ok', data: sentenceData },
      initialStatsOutcome: { status: 'ok', data: statsData },
      ...props,
    } as never,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        SearchSegmentFilterContent: FilterStub,
        SearchSegmentSidebar: FilterStub,
        SearchSegmentContainer: {
          name: 'SearchSegmentContainer',
          props: ['searchData', 'isLoading', 'failure'],
          template:
            '<div data-testid="search-results">{{ searchData.results.length }}<template v-if="!searchData.results.length"><slot name="empty-actions" /></template></div>',
        },
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
        UiButtonPrimaryAction: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' },
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
  route.params = { query: 'word' };
  fetchSentences.mockResolvedValue({
    status: 'ok',
    data: { results: [], pagination: { cursor: null, hasMore: false } },
  });
  fetchStats.mockResolvedValue({ status: 'ok', data: { media: [], categories: [] } });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('a malformed search route parameter', () => {
  test('does not throw while the container reads it', () => {
    route.path = '/search/%E8%AD';
    route.params = { query: '%E8%AD' };

    expect(() => render()).not.toThrow();
  });
});

describe('the media list the sidebar is built from', () => {
  test('carries every title when the reader hides nothing', async () => {
    const wrapper = render({ statsData: { media: [mediaRow('a'), mediaRow('b')], categories: [] } });
    await flushPromises();

    expect(sidebarMedia(wrapper)).toEqual(['a', 'b']);
  });

  test('drops a hidden title before the sidebar ever sees it', async () => {
    hiddenMediaIds.value = ['b'];
    const wrapper = render({ statsData: { media: [mediaRow('a'), mediaRow('b')], categories: [] } });
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
      statsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toEqual(['ANIME:10', 'YOUTUBE:4']);
  });

  test('drops a hidden category’s tab entirely', async () => {
    hiddenCategories.value = ['YOUTUBE'];
    const wrapper = render({
      statsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
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
      statsData: { media: [], categories: [categoryRow('ANIME', 10), categoryRow('YOUTUBE', 4)] },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toContain('YOUTUBE:4');
  });

  test('a hidden TITLE is discounted from its category’s count, not just the list', async () => {
    // The server aggregates before the reader's list is applied, so leaving the
    // count alone advertises results the page will not show.
    hiddenMediaIds.value = ['b'];
    const wrapper = render({
      statsData: {
        media: [mediaRow('a', { matchCount: 6 }), mediaRow('b', { matchCount: 4 })],
        categories: [categoryRow('ANIME', 10)],
      },
    });
    await flushPromises();

    expect(sidebarCategories(wrapper)).toEqual(['ANIME:6']);
  });
});

describe('safe search error rendering', () => {
  test('renders a primed request error without retrying it during hydration', async () => {
    const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind: 'invalid-request' } } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'SearchSegmentContainer' }).props('failure')).toEqual({
      kind: 'invalid-request',
    });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(fetchSentences).not.toHaveBeenCalled();
    expect(fetchStats).not.toHaveBeenCalled();
  });

  test('offers a retry for a primed server failure, not an automatic second request', async () => {
    const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind: 'unavailable' } } });
    await flushPromises();
    expect(fetchSentences).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="search-results"] button').trigger('click');
    await flushPromises();
    expect(fetchSentences).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="search-failure-notice"]').exists()).toBe(false);
  });

  test('shows a stats-only failure for a nonempty query instead of an All 0 badge', async () => {
    const wrapper = render({
      sentenceData: { results: [{ media: {}, segment: {} }], pagination: { hasMore: false } },
      initialStatsOutcome: { status: 'error', failure: { kind: 'unavailable' } },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid="search-stats-error"]').text()).toContain('searchErrors.unavailable.message');
    expect(wrapper.find('[data-testid="search-category-tab-all"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="search-results"]').text()).toBe('1');
    expect(fetchStats).not.toHaveBeenCalled();
  });

  test('fetches intentionally unprimed stats rather than treating them as a failure', async () => {
    const wrapper = render({ initialStatsOutcome: null });
    await flushPromises();
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="search-failure-notice"]').exists()).toBe(false);
  });

  test('accepts a successful refreshed outcome and clears the previous error', async () => {
    const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind: 'invalid-request' } } });
    await wrapper.setProps({ initialSentenceOutcome: { status: 'ok', data: { results: [] } } });
    await flushPromises();
    expect(wrapper.find('[data-testid="search-failure-notice"]').exists()).toBe(false);
    expect(fetchSentences).not.toHaveBeenCalled();
  });

  test.each([null, 'c1'])(
    'paginates a short initial page in collection %s when metadata allows it',
    async (collectionId) => {
      const wrapper = render({
        collectionId,
        sentenceData: { results: [{ media: {}, segment: {} }], pagination: { cursor: 'next', hasMore: true } },
      });
      await flushPromises();

      expect(wrapper.text()).not.toContain('searchContainer.endOfResults');
      wrapper.findComponent({ name: 'CommonInfiniteScrollObserver' }).vm.$emit('intersect');
      await flushPromises();

      expect(fetchSentences).toHaveBeenCalledWith(expect.objectContaining({ collectionId }), { cursor: 'next' });
    },
  );

  test.each([
    { cursor: 'next', hasMore: false },
    { cursor: null, hasMore: true },
  ])('does not paginate without both hasMore and a cursor: %j', async (pagination) => {
    const wrapper = render({ sentenceData: { results: [{ media: {}, segment: {} }], pagination } });
    await flushPromises();

    expect(wrapper.findComponent({ name: 'CommonInfiniteScrollObserver' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('searchContainer.endOfResults');
    expect(fetchSentences).not.toHaveBeenCalled();
  });

  test('keeps previously loaded cards when pagination fails', async () => {
    const results = Array.from({ length: 30 }, () => ({ media: {}, segment: {} }));
    const wrapper = render({ sentenceData: { results, pagination: { cursor: 'next', hasMore: true } } });
    fetchSentences.mockResolvedValueOnce({ status: 'error', failure: { kind: 'unavailable' } });
    wrapper.findComponent({ name: 'CommonInfiniteScrollObserver' }).vm.$emit('intersect');
    await flushPromises();
    expect(wrapper.get('[data-testid="search-results"]').text()).toBe('30');
    expect(wrapper.get('[data-testid="search-failure-notice"]').text()).toContain('searchErrors.unavailable.message');
    expect(fetchSentences).toHaveBeenCalledWith(expect.anything(), { cursor: 'next' });

    fetchSentences.mockResolvedValueOnce({
      status: 'ok',
      data: { results: [{ media: {}, segment: {} }], pagination: { hasMore: false, cursor: null } },
    });
    await wrapper.get('.text-center button').trigger('click');
    await flushPromises();
    expect(fetchSentences).toHaveBeenLastCalledWith(expect.anything(), { cursor: 'next' });
    expect(wrapper.get('[data-testid="search-results"]').text()).toBe('31');
    expect(wrapper.find('[data-testid="search-failure-notice"]').exists()).toBe(false);
  });
});

describe('reusing the existing result view', () => {
  test.each(['invalid-request', 'rate-limited', 'quota-exceeded', 'not-found', 'unavailable'])(
    'passes the %s failure to the existing SegmentContainer',
    async (kind) => {
      const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind } } });
      await flushPromises();
      expect(wrapper.findComponent({ name: 'SearchSegmentContainer' }).props('failure')).toEqual({ kind });
      // The parent no longer renders a competing image or separate error view.
      expect(wrapper.find('img[src="/assets/no-results.gif"]').exists()).toBe(false);
      expect(fetchSentences).not.toHaveBeenCalled();
    },
  );

  test('preserves the failure while the existing retry control is loading', async () => {
    const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind: 'unavailable' } } });
    let finish!: (value: unknown) => void;
    fetchSentences.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await wrapper.get('[data-testid="search-results"] button').trigger('click');
    expect(wrapper.findComponent({ name: 'SearchSegmentContainer' }).props('failure')).toEqual({ kind: 'unavailable' });
    expect(wrapper.get('[data-testid="search-results"] button').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="search-results"] button').text()).toContain('searchContainer.retrying');
    finish({ status: 'ok', data: { results: [], pagination: { hasMore: false } } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'SearchSegmentContainer' }).props('failure')).toBeNull();
  });
});

describe('client-side retry outcomes', () => {
  test('restores category tabs after a successful stats retry', async () => {
    const wrapper = render({ initialStatsOutcome: { status: 'error', failure: { kind: 'unavailable' } } });
    fetchStats.mockResolvedValueOnce({ status: 'ok', data: { media: [], categories: [categoryRow('ANIME', 10)] } });
    await wrapper.get('[data-testid="search-stats-error"] button').trigger('click');
    await flushPromises();
    expect(fetchStats).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="search-stats-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="search-category-tab-all"]').exists()).toBe(true);
    expect(sidebarCategories(wrapper)).toEqual(['ANIME:10']);
  });

  test('redirects a forbidden sentence retry rather than treating it as a service error', async () => {
    const wrapper = render({ initialSentenceOutcome: { status: 'error', failure: { kind: 'unavailable' } } });
    fetchSentences.mockResolvedValueOnce({ status: 'forbidden' });
    await wrapper.get('[data-testid="search-results"] button').trigger('click');
    await flushPromises();
    expect(navigateTo).toHaveBeenCalledWith('/', { redirectCode: 302 });
  });

  test('redirects a forbidden stats retry rather than treating it as empty statistics', async () => {
    const wrapper = render({ initialStatsOutcome: { status: 'error', failure: { kind: 'unavailable' } } });
    fetchStats.mockResolvedValueOnce({ status: 'forbidden' });
    await wrapper.get('[data-testid="search-stats-error"] button').trigger('click');
    await flushPromises();
    expect(navigateTo).toHaveBeenCalledWith('/', { redirectCode: 302 });
  });
});
