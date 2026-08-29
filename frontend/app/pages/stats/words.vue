<script setup lang="ts">
import type { CoveredWord, GetCoveredWordsResponse } from '@brigadasos/nadeshiko-sdk';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';
import { buildWordSearchPath } from '~/utils/routes';
import { reportError } from '~/utils/reportError';

const TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000] as const;

const { t } = useI18n();
const { formatNumber } = useFormat();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const activeTier = ref(Number(route.query.tier) || 1000);
if (!TIERS.includes(activeTier.value as (typeof TIERS)[number])) {
  activeTier.value = 1000;
}

/**
 * Both halves of the query string are validated HERE as well as in the watcher
 * below, and the filter used to be the exception.
 *
 * `?filter=` was taken at face value on the first render, which put an
 * unrecognised value straight into the request -- and then into the `href` of
 * all seven tier chips, since `queryFor` carries the active filter along.  Those
 * chips are the site's only links to most word pages, so a crawler arriving on a
 * malformed filter propagated it across the whole tier walk. The watcher already
 * did this; only the initial value was missed.
 */
const requestedFilter = route.query.filter;
const activeFilter = ref<'ALL' | 'COVERED' | 'UNCOVERED'>(
  requestedFilter === 'COVERED' || requestedFilter === 'UNCOVERED' ? requestedFilter : 'ALL',
);

function tierIndex(t: number): number {
  return TIERS.indexOf(t as (typeof TIERS)[number]);
}

function tierMinRank(t: number): number {
  const idx = tierIndex(t);
  return idx <= 0 ? 0 : (TIERS[idx - 1] ?? 0);
}

function tierLabel(t: number): string {
  const min = tierMinRank(t);
  const maxK = t / 1000;
  if (min === 0) return `1-${maxK}k`;
  return `${min / 1000}k-${maxK}k`;
}

useSeoMeta({
  title: () => t('seo.statsWords.title', { tier: tierLabel(activeTier.value) }),
  description: () => t('seo.statsWords.description', { tier: tierLabel(activeTier.value) }),
  ogTitle: () => t('seo.statsWords.title', { tier: tierLabel(activeTier.value) }),
  ogDescription: () => t('seo.statsWords.description', { tier: tierLabel(activeTier.value) }),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => t('seo.statsWords.title', { tier: tierLabel(activeTier.value) }),
  twitterDescription: () => t('seo.statsWords.description', { tier: tierLabel(activeTier.value) }),
});

const words = ref<CoveredWord[]>([]);
const tierStats = ref<GetCoveredWordsResponse['tierStats'] | null>(null);

const {
  hasMore,
  loading: loadingTier,
  loadingMore,
  load: loadTier,
  loadMore: fetchNextPage,
  seed: seedPagination,
} = useCursorPagination();
const loading = computed(() => loadingTier.value || loadingMore.value);

const sdk = useNadeshikoSdk();

async function fetchWordsRaw(
  tier: number,
  minRank: number,
  filter: string,
  cursor: string | undefined,
  take: number,
): Promise<GetCoveredWordsResponse | null> {
  return await sdk
    .getCoveredWords({ tier, minRank, filter: filter as 'ALL' | 'COVERED' | 'UNCOVERED', cursor, take })
    .catch((error: unknown) => {
      // Also runs during SSR, where a toast has nowhere to go. Returning null keeps
      // whatever is already on screen; the caller turns it into `loadFailed`, which
      // drives the inline notice.
      reportError('stats:covered-words-fetch-failed', error, { 'stats.tier': String(tier) });
      return null;
    });
}

const { data: initialData } = await useAsyncData(
  `words-${activeTier.value}-${activeFilter.value}`,
  () => fetchWordsRaw(activeTier.value, tierMinRank(activeTier.value), activeFilter.value, undefined, 500),
  { server: true, lazy: false },
);

// A failed tier fetch leaves `words` empty, which the grid below renders as a page
// with nothing on it -- same as a tier that genuinely has no entries.
const loadFailed = ref(initialData.value === null);

words.value = initialData.value?.words ?? [];
tierStats.value = initialData.value?.tierStats ?? null;
seedPagination(initialData.value?.pagination);

const fetchWordsPage = async (cursor: string | null) => {
  const data = await fetchWordsRaw(
    activeTier.value,
    tierMinRank(activeTier.value),
    activeFilter.value,
    cursor ?? undefined,
    500,
  );
  if (!data) return null;
  return { words: data.words, tierStats: data.tierStats, ...data.pagination };
};

/** Restarts the list for the active tier/filter, dropping any page still in flight. */
async function fetchWords() {
  const outcome = await loadTier(fetchWordsPage);
  if (outcome.status === 'stale') return;

  loadFailed.value = outcome.status === 'error';
  if (outcome.status !== 'ok') return;

  words.value = outcome.page.words;
  tierStats.value = outcome.page.tierStats;
}

/**
 * The query string this page's state lives in. Every control writes here and
 * nothing fetches directly -- the watcher below is the only thing that reloads
 * the grid, so a chip click and a pasted URL take the same path and cannot
 * disagree about what is on screen.
 *
 * Both controls navigate with `replace`, as they did before: seven tiers times
 * three filters is a lot of history entries for what is one page, and `back`
 * should leave rather than walk them.
 */
function queryFor(tier: number, filter: 'ALL' | 'COVERED' | 'UNCOVERED') {
  return { tier: String(tier), ...(filter !== 'ALL' ? { filter } : {}) };
}

/**
 * The tier chips are REAL LINKS, and that is the point of them.
 *
 * They used to be `<button @click>`, which meant the only `?tier=` a crawler
 * could ever see was whichever one the bare URL rendered -- the other six tiers
 * had no href anywhere on the site and were undiscoverable. This page carries
 * the site's only links to the ~19.8k word pages (`/search/<word>`, 98% of the
 * sitemap), so that put ~500 of them within reach and orphaned the rest.
 *
 * The active filter rides along so a crawler arriving from the sitemap on
 * `filter=COVERED` stays on covered words as it walks the tiers, rather than
 * being handed back the default `ALL` and its `noindex` entries.
 */
function tierLink(tier: number) {
  return localePath({ path: '/stats/words', query: queryFor(tier, activeFilter.value) });
}

function selectFilter(filter: 'ALL' | 'COVERED' | 'UNCOVERED') {
  router.replace({ query: queryFor(activeTier.value, filter) });
}

watch(
  () => route.query,
  (query) => {
    const requested = Number(query.tier);
    const tier = TIERS.includes(requested as (typeof TIERS)[number]) ? requested : 1000;
    const requestedFilter = query.filter;
    const filter = requestedFilter === 'COVERED' || requestedFilter === 'UNCOVERED' ? requestedFilter : 'ALL';
    if (tier === activeTier.value && filter === activeFilter.value) return;

    activeTier.value = tier;
    activeFilter.value = filter;
    fetchWords();
  },
);

async function loadMore() {
  const outcome = await fetchNextPage(fetchWordsPage);
  if (outcome.status === 'stale') return;

  loadFailed.value = outcome.status === 'error';
  if (outcome.status !== 'ok') return;

  words.value = [...words.value, ...outcome.page.words];
  tierStats.value = outcome.page.tierStats;
}

function filterCount(filter: 'ALL' | 'COVERED' | 'UNCOVERED'): string {
  if (!tierStats.value) return '';
  if (filter === 'ALL') return formatNumber(tierStats.value.total);
  if (filter === 'COVERED') return formatNumber(tierStats.value.covered);
  return formatNumber(tierStats.value.uncovered);
}

const onSentinelVisible = () => {
  if (hasMore.value && !loading.value) {
    loadMore();
  }
};
</script>

<template>
  <div class="nd-page px-4 md:px-0 pb-6 text-white">
    <div class="mb-6">
      <NuxtLink :to="localePath('/stats')" class="text-white/40 hover:text-white/60 text-sm transition-colors">
        &larr; {{ $t('statsWordsPage.back') }}
      </NuxtLink>
    </div>

    <div class="mb-6">
      <h1 class="text-2xl font-bold">{{ $t('statsWordsPage.title') }}</h1>
      <p class="text-white/50 text-sm mt-1">
        {{ $t('statsWordsPage.description.prefix') }}
        <a href="https://jiten.moe" target="_blank" rel="noopener" class="text-button-accent-main hover:text-button-accent-hover transition-colors">{{ $t('statsWordsPage.description.source') }}</a>
        {{ $t('statsWordsPage.description.suffix') }}
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <NuxtLink
        v-for="tier in TIERS"
        :key="tier"
        :to="tierLink(tier)"
        replace
        class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
        :class="activeTier === tier
          ? 'bg-white/15 text-white'
          : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'"
      >
        {{ tierLabel(tier) }}
      </NuxtLink>
    </div>

    <div class="flex items-center gap-3 mb-6">
      <div class="flex rounded-lg overflow-hidden border border-hairline">
        <button
          v-for="mode in (['ALL', 'COVERED', 'UNCOVERED'] as const)"
          :key="mode"
          class="px-3 py-1.5 text-xs font-medium transition-colors"
          :class="activeFilter === mode ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'"
          @click="selectFilter(mode)"
        >
          <template v-if="mode === 'ALL'">{{ $t('statsWordsPage.filters.all', { count: filterCount('ALL') }) }}</template>
          <template v-else-if="mode === 'COVERED'">{{ $t('statsWordsPage.filters.covered', { count: filterCount('COVERED') }) }}</template>
          <template v-else>{{ $t('statsWordsPage.filters.missing', { count: filterCount('UNCOVERED') }) }}</template>
        </button>
      </div>
    </div>

    <div v-if="loadFailed && !loading" class="py-12 text-center text-sm" data-testid="words-load-error">
      <p class="text-red-400">{{ $t('statsWordsPage.loadError') }}</p>
      <button
        type="button"
        class="mt-3 py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
        @click="fetchWords()"
      >
        {{ $t('searchContainer.retryButton') }}
      </button>
    </div>

    <template v-if="words.length || loading">
      <div class="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-1.5">
        <NuxtLink
          v-for="word in words"
          :key="word.rank"
          :to="localePath(buildWordSearchPath(word.word))"
          class="relative rounded-lg px-2 py-2.5 text-center transition-colors cursor-pointer"
          :class="[
            word.matchCount > 0
              ? 'bg-emerald-500/10 hover:bg-emerald-500/20'
              : 'bg-red-500/[0.06] hover:bg-red-500/10',
          ]"
        >
          <span
            class="block text-base font-medium leading-tight"
            :class="word.matchCount > 0 ? 'text-white/90' : 'text-white/50'"
            lang="ja"
          >
            {{ word.word }}
          </span>
          <span
            class="block text-[10px] mt-0.5 tabular-nums"
            :class="word.matchCount > 0 ? 'text-emerald-400/70' : 'text-red-400/40'"
          >
            {{ word.matchCount > 0 ? formatNumber(word.matchCount) : $t('statsWordsPage.missingLabel') }}
          </span>
          <span class="absolute top-0.5 left-1 text-[9px] text-white/15 tabular-nums">{{ word.rank }}</span>
        </NuxtLink>
      </div>

      <div v-if="words.length === 0 && !loading" class="py-12 text-center text-white/30 text-sm">
        {{ $t('statsWordsPage.empty') }}
      </div>

      <CommonInfiniteScrollObserver root-margin="400px" @intersect="onSentinelVisible" />

      <div v-if="loading" class="mt-4 text-center">
        <span class="text-white/40 text-sm">{{ $t('statsWordsPage.loading') }}</span>
      </div>

      <p class="text-white/30 text-xs mt-6">
        {{ $t('statsWordsPage.footer.prefix') }}
        <a href="https://jiten.moe" target="_blank" rel="noopener" class="hover:text-white/50 transition-colors">{{ $t('statsWordsPage.footer.source') }}</a>
        {{ $t('statsWordsPage.footer.suffix', {
          shown: formatNumber(words.length),
          total: tierStats?.total ? formatNumber(tierStats.total) : formatNumber(words.length),
        }) }}
      </p>
    </template>
  </div>
</template>
