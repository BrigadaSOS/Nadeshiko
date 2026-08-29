// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive, ref } from 'vue';

/**
 * The media filter: the panel that narrows a search to one title, then to one
 * episode of it.
 *
 * Two things here are worth pinning rather than trusting. The ORDER is three
 * rules deep -- starred, then what the reader is already studying, then
 * alphabetical -- and every way it breaks still renders a plausible list of
 * titles, so nobody reports it. And the EPISODE numbers are sorted as numbers;
 * the moment that becomes a string sort, episode 10 files itself between 1 and
 * 2 and stays there, on every series long enough for anyone to notice.
 *
 * `$t` returns its key, so copy changes never break a structural assertion.
 */
// `vi.hoisted`, because the mock factory is lifted above every top-level const
// and would otherwise read the symbol before it exists.
const { EPISODE_HITS_LOADING } = vi.hoisted(() => ({ EPISODE_HITS_LOADING: Symbol('episodeHitsLoading') }));
vi.mock('~/composables/useSearchFetch', () => ({ EPISODE_HITS_LOADING }));

const selectMedia = vi.fn();
const setQuery = vi.fn();
const routeQuery = reactive<Record<string, string>>({});
const routeParams = reactive<Record<string, string>>({});
const favoriteMediaIds = ref<ReadonlySet<string>>(new Set());
const inferredRank = ref<ReadonlyMap<string, number>>(new Map());

vi.stubGlobal('useRoute', () => ({ query: routeQuery, params: routeParams }));
vi.stubGlobal('useQuerySync', () => ({ setQuery }));
vi.stubGlobal('useMediaScope', () => ({ isMediaPage: ref(false), selectMedia }));
// Mirrors the real fallthrough: the preferred name, then whichever exists.
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m.nameEn || m.nameJa || m.nameRomaji || '',
}));
vi.stubGlobal('useFavoriteMedia', () => ({ favoriteMediaIds }));
vi.stubGlobal('useFamiliarMedia', () => ({ inferredRank }));

import FilterContent from './FilterContent.vue';

/** Renders slots, because everything asserted below is inside one. */
const PanelShell = {
  template: `<div class="shell"><div class="hd"><slot name="header" /></div>
    <div class="sub"><slot name="subheader" /></div><slot /></div>`,
};
const FilterRow = {
  props: ['rowId', 'label', 'count', 'selected', 'truncate', 'title'],
  emits: ['select'],
  template: `<button class="row" :data-row-id="rowId" :data-selected="String(!!selected)"
    @click="$emit('select')"><span class="label">{{ label }}</span><span class="count">{{ count }}</span></button>`,
};

type Row = Record<string, unknown>;

/** A title as the search payload carries one. */
function media(id: string, names: Partial<Row> = {}, extra: Partial<Row> = {}): Row {
  return {
    mediaPublicId: id,
    slug: `${id}-slug`,
    nameEn: id,
    nameJa: '',
    nameRomaji: '',
    matchCount: 1,
    category: 'ANIME',
    airingFormat: 'TV',
    episodeHits: [],
    ...names,
    ...extra,
  };
}

const mounted: { unmount: () => void }[] = [];

function render(rows: Row[], props: Record<string, unknown> = {}, loadingEpisodes = false) {
  const wrapper = mount(FilterContent, {
    props: { searchData: { media: rows } as never, ...props },
    global: {
      provide: { [EPISODE_HITS_LOADING]: ref(loadingEpisodes) },
      mocks: { $t: (key: string) => key },
      stubs: {
        SearchSegmentFilterPanelShell: PanelShell,
        SearchSegmentFilterRow: FilterRow,
        SearchSegmentFilterFavoriteStar: true,
        UiBaseIcon: true,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/** The visible row labels, in render order. */
function labels(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll('.row .label').map((n) => n.text());
}

/** Types into the filter box and lets the 300ms debounce elapse. */
async function typeSearch(wrapper: ReturnType<typeof render>, text: string) {
  await wrapper.find('input[type="search"]').setValue(text);
  vi.advanceTimersByTime(300);
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const key of Object.keys(routeQuery)) delete routeQuery[key];
  for (const key of Object.keys(routeParams)) delete routeParams[key];
  favoriteMediaIds.value = new Set();
  inferredRank.value = new Map();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('the title list', () => {
  test('shows every title the search came back with', () => {
    expect(labels(render([media('Bocchi'), media('Frieren')]))).toEqual(['Bocchi', 'Frieren']);
  });

  test('orders alphabetically for a reader with no stars and no history', () => {
    // The property the sort must preserve: a signed-out reader gets exactly the
    // plain alphabetical list the filter had before any of this existed.
    expect(labels(render([media('Yuru'), media('Bocchi'), media('Mushishi')]))).toEqual(['Bocchi', 'Mushishi', 'Yuru']);
  });

  test('puts starred titles first, whatever their name', () => {
    favoriteMediaIds.value = new Set(['Yuru']);

    expect(labels(render([media('Bocchi'), media('Yuru'), media('Mushishi')]))[0]).toBe('Yuru');
  });

  test('then the titles the reader is already studying, strongest signal first', () => {
    // Inferred titles keep the SERVER's ranking rather than going alphabetical:
    // the reader never chose this order, so the strongest signal leads.
    inferredRank.value = new Map([
      ['Zoku', 1],
      ['Aria', 2],
    ]);

    expect(labels(render([media('Bocchi'), media('Aria'), media('Zoku')]))).toEqual(['Zoku', 'Aria', 'Bocchi']);
  });

  test('starred beats studied, so a star always wins', () => {
    favoriteMediaIds.value = new Set(['Zzz']);
    inferredRank.value = new Map([['Aaa', 1]]);

    expect(labels(render([media('Aaa'), media('Zzz')]))).toEqual(['Zzz', 'Aaa']);
  });
});

describe('searching the list', () => {
  const ROWS = [
    media('Bocchi', { nameEn: 'Bocchi the Rock', nameJa: 'ぼっち・ざ・ろっく', nameRomaji: 'Botchi Za Rokku' }),
    media('Frieren', { nameEn: 'Frieren', nameJa: '葬送のフリーレン', nameRomaji: 'Sousou no Frieren' }),
  ];

  test('matches an English title', async () => {
    const wrapper = render(ROWS);

    await typeSearch(wrapper, 'bocchi');

    expect(labels(wrapper)).toEqual(['Bocchi the Rock']);
  });

  test('matches a Japanese title', async () => {
    const wrapper = render(ROWS);

    await typeSearch(wrapper, '葬送');

    expect(labels(wrapper)).toEqual(['Frieren']);
  });

  test('matches romaji, which is what a reader who cannot type kana uses', async () => {
    const wrapper = render(ROWS);

    await typeSearch(wrapper, 'sousou');

    expect(labels(wrapper)).toEqual(['Frieren']);
  });

  test('ignores case', async () => {
    const wrapper = render(ROWS);

    await typeSearch(wrapper, 'BOCCHI');

    expect(labels(wrapper)).toEqual(['Bocchi the Rock']);
  });

  test('waits for the reader to STOP typing before re-filtering', async () => {
    // Otherwise the list reflows under every keystroke of a long title.
    const wrapper = render(ROWS);

    await wrapper.find('input[type="search"]').setValue('bocchi');
    vi.advanceTimersByTime(299);
    await nextTick();

    expect(labels(wrapper)).toHaveLength(2);
  });

  test('a title displayed in one language is still findable by typing another', async () => {
    // The row shows whichever name the reader's preference resolves to, but the
    // search reads all three -- so typing what you see always works, and so does
    // typing the name you happen to know it by.
    const wrapper = render([media('Frieren', { nameEn: 'Frieren', nameJa: '葬送のフリーレン' })]);

    await typeSearch(wrapper, 'フリーレン');

    expect(labels(wrapper)).toEqual(['Frieren']);
  });

  test('says nothing matched rather than showing a stale list', async () => {
    const wrapper = render(ROWS);

    await typeSearch(wrapper, 'nothing-by-this-name');

    expect(labels(wrapper)).toEqual([]);
  });
});

describe('narrowing by category', () => {
  const MIXED = [media('Anime', {}, { category: 'ANIME' }), media('Tube', {}, { category: 'YOUTUBE' })];

  test('"all" shows every category', () => {
    expect(labels(render(MIXED, { categorySelected: 'all' }))).toHaveLength(2);
  });

  test('a chosen category hides the others', () => {
    expect(labels(render(MIXED, { categorySelected: 'anime' }))).toEqual(['Anime']);
  });
});

describe('drilling into a title', () => {
  const SERIES = media(
    'Bocchi',
    {},
    {
      episodeHits: [
        { episode: 2, hitCount: 5 },
        { episode: 1, hitCount: 3 },
      ],
    },
  );

  test('a selected series opens its episodes', () => {
    routeQuery.media = 'Bocchi';

    expect(labels(render([SERIES]))).toEqual(['searchpage.main.labels.episode 1', 'searchpage.main.labels.episode 2']);
  });

  test('episodes are ordered as NUMBERS, so 10 comes after 2', () => {
    // A string sort files 10 between 1 and 2 and leaves it there for good, on
    // every series long enough for it to matter.
    routeQuery.media = 'Bocchi';
    const long = media(
      'Bocchi',
      {},
      {
        episodeHits: [10, 2, 1, 11].map((episode) => ({ episode, hitCount: 1 })),
      },
    );

    expect(labels(render([long]))).toEqual([1, 2, 10, 11].map((n) => `searchpage.main.labels.episode ${n}`));
  });

  test('a MOVIE never drills in, because there is nothing under it', () => {
    routeQuery.media = 'Film';

    expect(labels(render([media('Film', {}, { airingFormat: 'MOVIE' })]))).toEqual(['Film']);
  });

  test('clicking the title already in scope drops it', () => {
    routeQuery.media = 'Bocchi';
    const wrapper = render([media('Bocchi', {}, { airingFormat: 'MOVIE' })]);

    wrapper.find('.row').trigger('click');

    expect(selectMedia).toHaveBeenCalledWith(null);
  });

  test('clicking a different title scopes to it, slug and all', () => {
    const wrapper = render([media('Bocchi')]);

    wrapper.find('.row').trigger('click');

    expect(selectMedia).toHaveBeenCalledWith('Bocchi', 'Bocchi-slug');
  });

  test('says the counts are still loading rather than "no episodes"', () => {
    // The counts are fetched separately now, so an empty list mid-request would
    // otherwise tell the reader a title plainly full of episodes has none.
    routeQuery.media = 'Bocchi';
    const wrapper = render([media('Bocchi', {}, { episodeHits: [] })], {}, true);

    expect(wrapper.text()).toContain('segmentSidebar.loading');
    expect(wrapper.text()).not.toContain('episodeFilter.noEpisodes');
  });

  test('and says there are none once the request has finished', () => {
    routeQuery.media = 'Bocchi';
    const wrapper = render([media('Bocchi', {}, { episodeHits: [] })], {}, false);

    expect(wrapper.text()).toContain('episodeFilter.noEpisodes');
  });
});

describe('picking an episode', () => {
  const SERIES = media('Bocchi', {}, { episodeHits: [{ episode: 1, hitCount: 3 }] });

  test('writes it to the query, which is where this panel keeps its state', () => {
    routeQuery.media = 'Bocchi';
    const wrapper = render([SERIES]);

    wrapper.find('.row').trigger('click');

    expect(setQuery).toHaveBeenCalledWith({ episode: '1' }, { scroll: true });
  });

  test('clicking the selected episode again clears it', () => {
    routeQuery.media = 'Bocchi';
    routeQuery.episode = '1';
    const wrapper = render([SERIES]);

    wrapper.find('.row').trigger('click');

    expect(setQuery).toHaveBeenCalledWith({ episode: null }, { scroll: true });
  });
});
