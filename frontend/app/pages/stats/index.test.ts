// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

/**
 * The corpus statistics page.
 *
 * Its numbers are all shares of a total, and the total is a figure from the
 * database that can legitimately be zero on a fresh or half-loaded corpus. Every
 * one of these divisions therefore has a guard, and every missing guard renders
 * as `NaN%` or an `Infinity%`-wide bar -- printed confidently, on a page whose
 * entire job is to state facts about the corpus.
 *
 * The rounding is load-bearing too: official, machine and untranslated are drawn
 * as three segments of one bar, so they have to add to exactly 100% at the
 * precision they are rendered with, or the bar shows a seam.
 */
const getStatsOverview = vi.fn();

// The stub carries EVERY param, not just `count`: the percentages reach the
// page through `percent`, and a stub that drops it makes every assertion about
// a rendered share pass without the share being there.
const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k}(${Object.values(p).join(',')})` : k);
vi.stubGlobal('useI18n', () => ({ t: tr, locale: ref('en') }));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => String(n),
  formatPercent: (n: number) => `${(n * 100).toFixed(1)}%`,
  formatDate: (d: unknown) => String(d),
}));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useRequestURL', () => new URL('https://nadeshiko.test/stats'));
vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('userStore', () => ({ isLoggedIn: false, isAdmin: false }));
vi.stubGlobal('useNadeshikoSdk', () => ({ getStatsOverview, triggerCoveredWordsUpdate: vi.fn() }));
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

import StatsPage from './index.vue';

/** The overview payload, with the field names the template actually reads --
 *  getting these wrong renders the whole section as `undefined` and the
 *  arithmetic under test never runs at all. */
const overview = (over: Record<string, unknown> = {}) => ({
  totalFrequencyWords: 100000,
  totalSegments: 1234,
  totalMedia: 12,
  totalEpisodes: 340,
  dialogueHours: 56,
  lastUpdated: '2026-08-01T00:00:00Z',
  tiers: [
    { tier: 1000, covered: 900, total: 1000 },
    { tier: 10000, covered: 7000, total: 10000 },
  ],
  translations: { total: 1000, enHuman: 400, enMachine: 300, esHuman: 200, esMachine: 100 },
  ...over,
});

const mounted: { unmount: () => void }[] = [];

async function render(data: Record<string, unknown> | null = overview()) {
  if (data === null) getStatsOverview.mockRejectedValue(new Error('down'));
  else getStatsOverview.mockResolvedValue(data);

  const Host = defineComponent({
    components: { StatsPage },
    template: '<Suspense><StatsPage /></Suspense>',
  });
  const wrapper = mount(Host, {
    global: {
      mocks: { $t: tr },
      stubs: { NuxtLink: { props: ['to'], template: '<a><slot /></a>' }, UiBaseIcon: true, CommonBaseModal: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

/** Every percentage width the page drew, as numbers. */
function barWidths(wrapper: ReturnType<typeof mount>) {
  return [...wrapper.html().matchAll(/width:\s*([\d.eE+-]+|NaN|Infinity)%/g)].map((m) => Number(m[1]));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the translation shares', () => {
  test('are drawn as sane percentages', async () => {
    const wrapper = await render();

    const widths = barWidths(wrapper);
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) {
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
    }
  });

  test('a corpus with NO translations draws empty bars rather than dividing by zero', async () => {
    // A legitimate state on a fresh or half-loaded corpus, and the one that
    // divides by zero. Asserted as bars AT ZERO rather than as "no NaN in the
    // HTML": Vue drops a style property whose value is invalid, so an unguarded
    // `NaN%` disappears from the markup entirely and leaves nothing to see.
    const wrapper = await render(
      overview({ translations: { total: 0, enHuman: 0, enMachine: 0, esHuman: 0, esMachine: 0 } }),
    );

    const widths = barWidths(wrapper);
    expect(widths.length).toBeGreaterThanOrEqual(4);
    for (const w of widths) expect(w).toBe(0);
  });

  test('and reports every share as 0%, not as NaN%', async () => {
    const wrapper = await render(
      overview({ translations: { total: 0, enHuman: 0, enMachine: 0, esHuman: 0, esMachine: 0 } }),
    );

    expect(wrapper.text()).not.toContain('NaN');
    expect(wrapper.text()).toContain('0.0%');
  });

  test('the untranslated share is never negative', async () => {
    // Official + machine can exceed the total once each is rounded; a negative
    // remainder prints as "-1.0% untranslated", which is not a thing.
    const wrapper = await render(
      overview({ translations: { total: 100, enHuman: 60, enMachine: 41, esHuman: 0, esMachine: 0 } }),
    );

    // Scoped to PERCENTAGES: the last-updated date carries hyphens of its own.
    expect(wrapper.text()).not.toMatch(/-\d+(\.\d+)?%/);
    for (const w of barWidths(wrapper)) expect(w).toBeGreaterThanOrEqual(0);
  });

  test('a page with no translation block at all still renders', async () => {
    const wrapper = await render(overview({ translations: undefined }));

    expect(wrapper.html()).not.toContain('NaN');
  });
});

describe('the coverage tiers', () => {
  test('the headline figure is the largest tier’s covered count', async () => {
    // The tiers NEST, so the biggest already includes every smaller one --
    // summing them counts the first thousand words twice. Asserted on a figure
    // that only the sum could produce, because the tier rows below print the
    // per-tier counts too and any of those would satisfy a bare "contains".
    const wrapper = await render(
      overview({
        tiers: [
          { tier: 1000, covered: 900, total: 1000 },
          { tier: 10000, covered: 7000, total: 10000 },
        ],
      }),
    );

    expect(wrapper.text()).not.toContain('7900');
  });

  test('a corpus with no tiers reports zero rather than crashing', async () => {
    const wrapper = await render(overview({ tiers: [] }));

    expect(wrapper.html()).not.toContain('NaN');
  });

  test('the top tier is named for the whole corpus, not a round number', async () => {
    // `100k` would be a lie once the corpus is 100,000 words: that tier IS all
    // of them.
    const wrapper = await render(overview({ totalFrequencyWords: 10000 }));

    expect(wrapper.text()).toContain('statsPage.coverage.fullCorpus');
  });

  test('smaller tiers are named in thousands', async () => {
    const wrapper = await render();

    expect(wrapper.text()).toContain('statsPage.coverage.topWordsK');
  });
});

describe('when the statistics cannot be loaded', () => {
  test('the page still renders rather than throwing', async () => {
    const wrapper = await render(null);

    expect(wrapper.html()).toBeTruthy();
    expect(wrapper.html()).not.toContain('NaN');
  });
});
