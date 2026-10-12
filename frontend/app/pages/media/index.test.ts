// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

// Normalize URL state before rendering. An explicit category overrides category hiding,
// but individually hidden titles stay hidden.
const route = reactive<{ query: Record<string, unknown>; params: Record<string, unknown> }>({ query: {}, params: {} });
const hiddenMediaIds = ref<string[]>([]);
const hasHiddenCategories = ref(false);
const hiddenCategoryNames = ref<string[]>([]);
const push = vi.fn();
const listMedia = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ push }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/media'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useSchemaOrg', vi.fn());
vi.stubGlobal('defineWebPage', (v: unknown) => v);
vi.stubGlobal('defineBreadcrumb', (v: unknown) => v);
vi.stubGlobal('defineItemList', (v: unknown) => v);
vi.stubGlobal('useQuerySync', () => ({ setQuery: vi.fn() }));
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
// The directly imported userStore uses real Pinia defaults; global stubs cannot replace it.
vi.stubGlobal('useMediaName', () => ({
  mediaName: (m: Record<string, string>) => m.nameEn ?? '',
  secondaryMediaNames: () => '',
  language: ref('ENGLISH'),
}));
vi.stubGlobal('useNadeshikoSdk', () => ({ listMedia }));
vi.stubGlobal('useMediaDisplayName', () => ({
  displayMediaName: (m: Record<string, string>) => m.nameEn ?? '',
  secondaryMediaNames: () => '',
}));
vi.stubGlobal('useHiddenMedia', () => ({
  hiddenMediaIds,
  isMediaHidden: (id: string) => hiddenMediaIds.value.includes(id),
}));
vi.stubGlobal('useHiddenCategories', () => ({
  hasHiddenCategories,
  isCategoryHidden: (c: string) => hiddenCategoryNames.value.includes(c),
  hiddenCategories: hiddenCategoryNames,
}));
vi.stubGlobal('useAsyncData', async (_k: string, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const pending = ref(false);
  const refresh = async () => {
    data.value = await handler();
  };
  await refresh();
  return { data, pending, refresh, error: ref(null) };
});

import { useCursorPagination } from '~/composables/useCursorPagination';
// The real one: its stale handling is part of what the page leans on.
vi.stubGlobal('useCursorPagination', useCursorPagination);

import MediaIndex from './index.vue';

function title(publicId: string, over: Record<string, unknown> = {}) {
  return {
    publicId,
    nameEn: publicId,
    nameJa: '',
    nameRomaji: '',
    slug: publicId,
    category: 'ANIME',
    airingFormat: 'TV',
    episodeCount: 12,
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(titles: unknown[] = [title('a'), title('b')], cursor: string | null = null) {
  listMedia.mockResolvedValue({ media: titles, pagination: { hasMore: cursor !== null, cursor } });
  const Host = defineComponent({
    components: { MediaIndex },
    template: '<Suspense><MediaIndex /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :data-to="typeof to === \'string\' ? to : JSON.stringify(to)"><slot /></a>',
        },
        NuxtImg: true,
        UiBaseIcon: true,
        MediaCountLabel: true,
        // Stub MediaCover: list rendering otherwise reaches composables absent from this harness.
        MediaCover: true,
        CommonBaseModal: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const cardTitles = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="media-card-title"]').map((n) => n.text());

beforeEach(() => {
  vi.clearAllMocks();
  route.query = {};
  hiddenMediaIds.value = [];
  hasHiddenCategories.value = false;
  hiddenCategoryNames.value = [];
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('reading the page’s state out of the URL', () => {
  test('defaults to the grid', async () => {
    const wrapper = await render();

    expect(wrapper.find('[data-testid="media-grid"]').exists()).toBe(true);
  });

  test('`?view=list` switches to the list', async () => {
    route.query = { view: 'list' };
    const wrapper = await render();

    expect(wrapper.findAll('[data-testid="media-list-item"]').length).toBeGreaterThan(0);
  });

  test('a view it does not recognise falls back to the grid', async () => {
    route.query = { view: 'nonsense' };
    const wrapper = await render();

    expect(wrapper.find('[data-testid="media-grid"]').exists()).toBe(true);
  });

  test('a search term in the URL is put back in the box', async () => {
    route.query = { query: 'bocchi' };
    const wrapper = await render();

    expect((wrapper.get('[data-testid="media-search-input"]').element as HTMLInputElement).value).toBe('bocchi');
  });

  test('a non-string query is treated as no query at all', async () => {
    // `?query=a&query=b` arrives as an array.
    route.query = { query: ['a', 'b'] };
    const wrapper = await render();

    expect((wrapper.get('[data-testid="media-search-input"]').element as HTMLInputElement).value).toBe('');
  });

  test('a category it does not know is dropped rather than sent on', async () => {
    route.query = { category: 'NOT_A_CATEGORY' };
    await render();

    expect(listMedia.mock.calls.at(-1)?.[0]?.category).toBeFalsy();
  });

  test('a category it does know is passed through', async () => {
    route.query = { category: 'ANIME' };
    await render();

    expect(listMedia.mock.calls.at(-1)?.[0]?.category).toBe('ANIME');
  });
});

describe('what a reader has hidden', () => {
  test('a hidden title is dropped from the grid', async () => {
    hiddenMediaIds.value = ['b'];
    const wrapper = await render([title('a'), title('b')]);

    expect(cardTitles(wrapper)).toEqual(['a']);
  });

  test('a hidden CATEGORY is dropped too', async () => {
    hasHiddenCategories.value = true;
    hiddenCategoryNames.value = ['YOUTUBE'];
    const wrapper = await render([title('a'), title('tube', { category: 'YOUTUBE' })]);

    expect(cardTitles(wrapper)).toEqual(['a']);
  });

  test('but asking for that category explicitly overrides the hiding', async () => {
    // Picking it from the dropdown is a request for it, and the same override
    // `?category=` gets on search. Hiding winning here would show the reader an
    // empty page for a filter they just chose.
    hasHiddenCategories.value = true;
    hiddenCategoryNames.value = ['YOUTUBE'];
    route.query = { category: 'YOUTUBE' };
    const wrapper = await render([title('tube', { category: 'YOUTUBE' })]);

    expect(cardTitles(wrapper)).toEqual(['tube']);
  });

  test('a hidden TITLE stays hidden even inside its own category', async () => {
    // The category override is about categories; it must not resurrect a title
    // the reader hid one by one.
    hiddenMediaIds.value = ['tube'];
    route.query = { category: 'YOUTUBE' };
    const wrapper = await render([title('tube', { category: 'YOUTUBE' })]);

    expect(cardTitles(wrapper)).toEqual([]);
  });

  test('nothing hidden means nothing is filtered', async () => {
    const wrapper = await render([title('a'), title('b')]);

    expect(cardTitles(wrapper)).toEqual(['a', 'b']);
  });
});

describe('paging', () => {
  test('offers a next page only when there is a cursor', async () => {
    expect((await render([title('a')], null)).html()).not.toContain('cursor');
  });

  test('and carries the current filters into it', async () => {
    route.query = { category: 'ANIME', query: 'bo' };
    const wrapper = await render([title('a')], 'CUR');

    const next = wrapper.findAll('a').find((a) => a.attributes('data-to')?.includes('CUR'));
    expect(next?.attributes('data-to')).toContain('ANIME');
    expect(next?.attributes('data-to')).toContain('bo');
  });
});
