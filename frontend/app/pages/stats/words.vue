<script setup lang="ts">
import type { CoveredWord, GetCoveredWordsResponse } from '@brigadasos/nadeshiko-sdk';
import { buildWordSearchPath } from '~/utils/routes';
import { reportError } from '~/utils/reportError';

const TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000] as const;

const { t } = useI18n();
const { formatNumber } = useFormat();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();

const activeTier = ref(Number(route.query.tier) || 1000);
const activeFilter = ref<'ALL' | 'COVERED' | 'UNCOVERED'>(
  (route.query.filter as 'ALL' | 'COVERED' | 'UNCOVERED') || 'ALL',
);
if (!TIERS.includes(activeTier.value as (typeof TIERS)[number])) {
  activeTier.value = 1000;
}

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
  ogImage: `${useRequestURL().origin}/logo-og-5bc76788.png`,
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

function updateUrl() {
  router.replace({
    query: {
      tier: String(activeTier.value),
      ...(activeFilter.value !== 'ALL' ? { filter: activeFilter.value } : {}),
    },
  });
}

async function selectTier(tier: number) {
  activeTier.value = tier;
  updateUrl();
  await fetchWords();
}

async function selectFilter(filter: 'ALL' | 'COVERED' | 'UNCOVERED') {
  activeFilter.value = filter;
  updateUrl();
  await fetchWords();
}

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
  <div class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6 text-white">
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
      <button
        v-for="tier in TIERS"
        :key="tier"
        class="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
        :class="activeTier === tier
          ? 'bg-white/15 text-white'
          : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'"
        @click="selectTier(tier)"
      >
        {{ tierLabel(tier) }}
      </button>
    </div>

    <div class="flex items-center gap-3 mb-6">
      <div class="flex rounded-lg overflow-hidden border border-white/10">
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
