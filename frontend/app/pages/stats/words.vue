<script setup lang="ts">
import type { CoveredWord, GetCoveredWordsResponse } from '@brigadasos/nadeshiko-sdk';
import { buildWordSearchPath } from '~/utils/routes';

const TIERS = [1000, 2000, 5000, 10000, 20000, 50000, 100000] as const;

const { t } = useI18n();
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
const nextCursor = ref<string | null>(null);
const tierStats = ref<GetCoveredWordsResponse['tierStats'] | null>(null);
const loading = ref(false);
const scrollSentinel = ref<HTMLElement | null>(null);

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
    .catch(() => null);
}

const { data: initialData } = await useAsyncData(
  `words-${activeTier.value}-${activeFilter.value}`,
  () => fetchWordsRaw(activeTier.value, tierMinRank(activeTier.value), activeFilter.value, undefined, 500),
  { server: true, lazy: false },
);

words.value = initialData.value?.words ?? [];
nextCursor.value = initialData.value?.pagination?.cursor ?? null;
tierStats.value = initialData.value?.tierStats ?? null;

async function fetchWords(cursor: string | undefined = undefined, append: boolean = false) {
  loading.value = true;
  try {
    const data = await fetchWordsRaw(activeTier.value, tierMinRank(activeTier.value), activeFilter.value, cursor, 500);
    if (!data) return;
    if (append) {
      words.value = [...words.value, ...data.words];
    } else {
      words.value = data.words;
    }
    tierStats.value = data.tierStats;
    nextCursor.value = data.pagination?.cursor ?? null;
  } finally {
    loading.value = false;
  }
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
  if (nextCursor.value && !loading.value) {
    await fetchWords(nextCursor.value, true);
  }
}

function filterCount(filter: 'ALL' | 'COVERED' | 'UNCOVERED'): string {
  if (!tierStats.value) return '';
  if (filter === 'ALL') return tierStats.value.total.toLocaleString();
  if (filter === 'COVERED') return tierStats.value.covered.toLocaleString();
  return tierStats.value.uncovered.toLocaleString();
}

let observer: IntersectionObserver | null = null;

onMounted(() => {
  if (!scrollSentinel.value) return;

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && nextCursor.value != null && !loading.value) {
        loadMore();
      }
    },
    { rootMargin: '400px' },
  );

  observer.observe(scrollSentinel.value);
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6 text-white">
    <div class="mb-6">
      <NuxtLink :to="localePath('/stats')" class="text-white/40 hover:text-white/60 text-sm transition-colors">
        &larr; Back to Stats
      </NuxtLink>
    </div>

    <div class="mb-6">
      <h1 class="text-2xl font-bold">Word Coverage</h1>
      <p class="text-white/50 text-sm mt-1">
        Browse words from the <a href="https://jiten.moe" target="_blank" rel="noopener" class="text-button-accent-main hover:text-button-accent-hover transition-colors">Jiten</a> anime frequency list and their coverage in Nadeshiko's corpus.
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
          <template v-if="mode === 'ALL'">All ({{ filterCount('ALL') }})</template>
          <template v-else-if="mode === 'COVERED'">Covered ({{ filterCount('COVERED') }})</template>
          <template v-else>Missing ({{ filterCount('UNCOVERED') }})</template>
        </button>
      </div>
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
            {{ word.matchCount > 0 ? word.matchCount.toLocaleString() : 'missing' }}
          </span>
          <span class="absolute top-0.5 left-1 text-[9px] text-white/15 tabular-nums">{{ word.rank }}</span>
        </NuxtLink>
      </div>

      <div v-if="words.length === 0 && !loading" class="py-12 text-center text-white/30 text-sm">
        No words match the current filter.
      </div>

      <div ref="scrollSentinel" class="h-1" />

      <div v-if="loading" class="mt-4 text-center">
        <span class="text-white/40 text-sm">Loading...</span>
      </div>

      <p class="text-white/30 text-xs mt-6">
        Frequency data from <a href="https://jiten.moe" target="_blank" rel="noopener" class="hover:text-white/50 transition-colors">Jiten</a> anime corpus.
        Showing {{ words.length.toLocaleString() }} of {{ tierStats?.total?.toLocaleString() ?? words.length.toLocaleString() }} words.
      </p>
    </template>
  </div>
</template>
