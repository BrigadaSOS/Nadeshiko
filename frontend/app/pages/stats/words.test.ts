// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

/**
 * The word-coverage page: which of the N most common words the corpus has a
 * sentence for.
 *
 * Its whole state lives in the query string, and the TIER arithmetic is what
 * turns that into a request: `?tier=2000` means "the second thousand", so the
 * page has to send a lower bound of 1000 as well. Getting that wrong asks for a
 * range that overlaps the one before it and the page fills with words the reader
 * has already been shown -- a plausible-looking list that is simply the wrong
 * band, which nobody can spot by reading it.
 *
 * The tier chips are also REAL LINKS on purpose: this page carries the site's
 * only links to ~19.8k word pages, and as buttons the other six tiers had no
 * href anywhere and were undiscoverable. Their `href` is therefore load-bearing
 * rather than decorative.
 */
const route = reactive({ path: '/stats/words', params: {}, query: {} as Record<string, unknown> });
const replace = vi.fn();
const getCoveredWords = vi.fn();

vi.stubGlobal('useI18n', () => ({
  t: (k: string, p?: Record<string, unknown>) => (p ? `${k}(${p.tier})` : k),
  locale: ref('en'),
}));
vi.stubGlobal('useRoute', () => route);
vi.stubGlobal('useRouter', () => ({ replace, push: vi.fn() }));
vi.stubGlobal('useLocalePath', () => (p: unknown) => (typeof p === 'string' ? p : JSON.stringify(p)));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n) }));
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/stats/words'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('useNadeshikoSdk', () => ({ getCoveredWords }));
vi.stubGlobal('useAsyncData', async (_k: string, handler: () => Promise<unknown>) => {
  const data = ref<unknown>(null);
  const refresh = async () => {
    data.value = await handler();
  };
  await refresh();
  return { data, refresh, pending: ref(false), error: ref(null) };
});

import { useCursorPagination } from '~/composables/useCursorPagination';
vi.stubGlobal('useCursorPagination', useCursorPagination);

import WordsPage from './words.vue';

const word = (w: string, covered = true) => ({ word: w, rank: 1, covered, sentenceCount: covered ? 3 : 0 });

const mounted: { unmount: () => void }[] = [];

async function render(words = [word('猫')], tierStats = { total: 100, covered: 60, uncovered: 40 }) {
  getCoveredWords.mockResolvedValue({ words, tierStats, pagination: { cursor: null, hasMore: false } });
  const Host = defineComponent({
    components: { WordsPage },
    template: '<Suspense><WordsPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :data-to="typeof to === \'string\' ? to : JSON.stringify(to)"><slot /></a>',
        },
        UiBaseIcon: true,
        CommonInfiniteScrollObserver: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** The arguments the coverage endpoint was last asked for. */
function lastQuery() {
  const call = getCoveredWords.mock.calls.at(-1);
  if (!call) throw new Error('the coverage endpoint was never called');
  return call[0] as Record<string, unknown>;
}

const tierLinks = (w: ReturnType<typeof mount>) =>
  w
    .findAll('a')
    .map((a) => a.attributes('data-to') ?? '')
    .filter((h) => h.includes('tier'));

beforeEach(() => {
  vi.clearAllMocks();
  route.query = {};
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('which band of words is asked for', () => {
  test('the first tier starts at rank zero', async () => {
    await render();

    expect(lastQuery()).toMatchObject({ tier: 1000, minRank: 0 });
  });

  test('a later tier starts where the one before it ended', async () => {
    // `?tier=2000` means the SECOND thousand. Without the lower bound the page
    // re-serves the first thousand under the second tier's heading.
    route.query = { tier: '2000' };
    await render();

    expect(lastQuery()).toMatchObject({ tier: 2000, minRank: 1000 });
  });

  test('and the top tier reaches back to the one below it', async () => {
    route.query = { tier: '100000' };
    await render();

    expect(lastQuery()).toMatchObject({ tier: 100000, minRank: 50000 });
  });

  test('a tier that is not one of the seven falls back to the first', async () => {
    // Rather than asking for a band the endpoint has no answer for.
    route.query = { tier: '1234' };
    await render();

    expect(lastQuery()).toMatchObject({ tier: 1000, minRank: 0 });
  });

  test('a nonsense tier does too', async () => {
    route.query = { tier: 'banana' };
    await render();

    expect(lastQuery()).toMatchObject({ tier: 1000 });
  });
});

describe('the covered/uncovered filter', () => {
  test('defaults to showing everything', async () => {
    await render();

    expect(lastQuery().filter).toBe('ALL');
  });

  test('reads the filter out of the URL', async () => {
    route.query = { filter: 'UNCOVERED' };
    await render();

    expect(lastQuery().filter).toBe('UNCOVERED');
  });

  test('a filter it does not know is treated as ALL', async () => {
    route.query = { filter: 'SOMETHING' };
    await render();

    expect(lastQuery().filter).toBe('ALL');
  });
});

describe('the tier chips', () => {
  test('are real links, because they are the only route to most word pages', async () => {
    // As buttons the other six tiers had no href anywhere on the site and were
    // undiscoverable; this page carries the only links to ~19.8k word pages.
    const wrapper = await render();

    expect(tierLinks(wrapper).length).toBeGreaterThanOrEqual(7);
  });

  test('carry the active filter, so a crawler stays on the same slice', async () => {
    // Arriving from the sitemap on `filter=COVERED` and being handed back the
    // default would walk it through `noindex` pages instead.
    route.query = { filter: 'COVERED' };
    const wrapper = await render();

    expect(tierLinks(wrapper).every((h) => h.includes('COVERED'))).toBe(true);
  });

  test('and leave the filter out when it is the default', async () => {
    const wrapper = await render();

    expect(tierLinks(wrapper).some((h) => h.includes('filter'))).toBe(false);
  });
});

describe('when the words cannot be loaded', () => {
  test('says so rather than rendering an empty band', async () => {
    // An empty grid is what a tier with no entries looks like too.
    getCoveredWords.mockRejectedValue(new Error('down'));
    const Host = defineComponent({
      components: { WordsPage },
      template: '<Suspense><WordsPage /></Suspense>',
    });
    const wrapper = mount(Host, {
      global: {
        mocks: { $t: (k: string) => k },
        stubs: {
          NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
          UiBaseIcon: true,
          CommonInfiniteScrollObserver: true,
        },
      },
    });
    mounted.push(wrapper);
    await flushPromises();

    expect(wrapper.find('[data-testid="words-load-error"]').exists()).toBe(true);
  });

  test('a tier that genuinely has nothing shows no error', async () => {
    const wrapper = await render([]);

    expect(wrapper.find('[data-testid="words-load-error"]').exists()).toBe(false);
  });
});
