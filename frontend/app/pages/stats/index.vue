<script setup lang="ts">
import { userStore } from '~/stores/auth';
import type { StatsOverviewResponse, UpdateResult } from '~/types/stats';

useSeoMeta({
  title: 'Stats - Nadeshiko',
  description:
    'See how well Nadeshiko covers the most common Japanese words. Coverage statistics based on the Jiten anime frequency list.',
  ogTitle: 'Stats - Nadeshiko',
  ogDescription:
    'See how well Nadeshiko covers the most common Japanese words. Coverage statistics based on the Jiten anime frequency list.',
  ogImage: `${useRequestURL().origin}/logo-og-5bc76788.png`,
  twitterCard: 'summary_large_image',
});

const { baseURL, headers } = useBackendFetchOptions();

const {
  data: stats,
  refresh: refreshStats,
  error: statsError,
} = await useAsyncData('stats-overview', () =>
  $fetch<StatsOverviewResponse>(`/v1/stats/overview`, { baseURL, headers }),
);

const updating = ref(false);
const updateResult = ref<UpdateResult | null>(null);

async function triggerUpdate(onlyUncovered: boolean) {
  updating.value = true;
  updateResult.value = null;
  try {
    const result = await $fetch<UpdateResult>('/v1/stats/covered-words/update', {
      method: 'POST',
      body: { onlyUncovered },
    });
    updateResult.value = result;
    await refreshStats();
  } catch (err) {
    console.error('Coverage update failed:', err);
  } finally {
    updating.value = false;
  }
}

function tierLabel(tier: number): string {
  if (stats.value && tier >= stats.value.totalFrequencyWords)
    return `Full corpus (${(stats.value.totalFrequencyWords / 1000).toFixed(0)}k words)`;
  if (tier >= 1000) return `Top ${(tier / 1000).toLocaleString()}k words`;
  return `Top ${tier.toLocaleString()} words`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const totalWordsCovered = computed(() => {
  if (!stats.value?.tiers?.length) return 0;
  const largest = stats.value.tiers.at(-1);
  return largest?.covered ?? 0;
});

function translationPercent(count: number): number {
  const total = stats.value?.translations?.total || 1;
  return Math.round((count / total) * 1000) / 10;
}

function translationNonePercent(human: number, machine: number): string {
  const none = 100 - translationPercent(human) - translationPercent(machine);
  return Math.max(0, none).toFixed(1);
}

function translationBarWidth(count: number): string {
  return `${(count / (stats.value?.translations?.total || 1)) * 100}%`;
}

const translationLanguages = computed(() => {
  const t = stats.value?.translations;
  if (!t) return [];
  return [
    { label: 'English', human: t.enHuman, machine: t.enMachine },
    { label: 'Spanish', human: t.esHuman, machine: t.esMachine },
  ];
});
</script>

<template>
  <div class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6 text-white">
    <div class="mb-3">
      <h1 class="text-[2.5rem] font-extrabold mb-2 pl-4 leading-tight relative before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:bg-button-accent-main before:rounded-sm">Nadeshiko in Numbers</h1>
      <p class="text-white/50 max-w-xl">
        How well does our corpus cover the Japanese language? We measure against the
        <a
          href="https://jiten.moe"
          target="_blank"
          rel="noopener"
          class="text-button-accent-main hover:text-button-accent-hover transition-colors"
        >Jiten</a>
        anime frequency list, built from {{ stats?.totalFrequencyWords?.toLocaleString() ?? '200,000+' }} unique words
        across thousands of anime.
      </p>
    </div>

    <div v-if="statsError" class="dark:bg-card-background rounded-lg px-5 py-5 mb-3 text-center text-white/40 text-sm">
      Failed to load statistics. Try refreshing the page.
    </div>

    <div v-if="stats" class="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-3 mb-3">
      <div class="flex flex-col gap-3">
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">Sentences</p>
          <p class="text-3xl font-bold tabular-nums">{{ stats.totalSegments.toLocaleString() }}+</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">Unique words</p>
          <p class="text-3xl font-bold tabular-nums text-button-accent-main">{{ totalWordsCovered.toLocaleString() }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">Total content</p>
          <p class="text-3xl font-bold tabular-nums">{{ stats.totalMedia }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">Episodes</p>
          <p class="text-3xl font-bold tabular-nums">{{ stats.totalEpisodes.toLocaleString() }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">Dialogue hours</p>
          <p class="text-3xl font-bold tabular-nums">{{ stats.dialogueHours.toLocaleString() }}</p>
        </div>
      </div>

      <div class="dark:bg-card-background rounded-lg px-5 py-5">
        <div class="flex items-baseline justify-between mb-5">
          <h2 class="text-lg font-semibold">Frequency Coverage</h2>
          <p v-if="stats?.lastUpdated" class="text-white/30 text-xs">
            Updated {{ formatDate(stats.lastUpdated) }}
          </p>
        </div>

        <div v-if="stats?.tiers" class="space-y-3">
          <NuxtLink
            v-for="tier in stats.tiers"
            :key="tier.tier"
            :to="`/stats/words?tier=${tier.tier}`"
            class="block group rounded-lg px-4 py-3 -mx-1 transition-colors hover:bg-white/[0.03]"
          >
            <div class="flex justify-between items-baseline mb-1.5">
              <span class="text-sm font-medium group-hover:text-white/90">
                {{ tierLabel(tier.tier) }}
              </span>
              <span class="text-sm">
                <span class="font-semibold tabular-nums text-button-accent-main">{{ tier.percentage }}%</span>
                <span class="text-white/30 ml-2 text-xs tabular-nums">{{ tier.covered.toLocaleString() }}/{{ tier.tier.toLocaleString() }}</span>
              </span>
            </div>
            <div class="w-full rounded-full h-2 nd-accent-bg-faint">
              <div
                class="h-2 rounded-full transition-all duration-500 bg-button-accent-main"
                :style="{ width: `${tier.percentage}%` }"
              />
            </div>
          </NuxtLink>
        </div>

        <div v-else class="py-8 text-center text-white/40 text-sm">
          No coverage data available yet.
        </div>
      </div>
    </div>

    <div v-if="stats?.translations" class="dark:bg-card-background rounded-lg px-5 py-5 mb-3">
      <div class="mb-5">
        <h2 class="text-lg font-semibold mb-1">Translation Availability</h2>
        <p class="text-white/40 text-sm max-w-2xl">
          Every sentence has Japanese subtitles. We aim to include English and Spanish translations for all content.
          Some sources lack reliable Spanish subtitles, so coverage may be lower for that language.
        </p>
      </div>

      <div class="space-y-5">
        <div v-for="lang in translationLanguages" :key="lang.label">
          <div class="flex justify-between items-baseline mb-2">
            <span class="text-sm font-medium">{{ lang.label }}</span>
            <span class="text-xs text-white/40 tabular-nums">
              {{ (translationPercent(lang.human) + translationPercent(lang.machine)).toFixed(1) }}% translated
            </span>
          </div>
          <div class="w-full h-2 rounded-full bg-white/[0.04] flex overflow-hidden">
            <div
              class="h-full bg-button-accent-main transition-all duration-500"
              :style="{ width: translationBarWidth(lang.human) }"
            />
            <div
              class="h-full nd-accent-bg-muted transition-all duration-500"
              :style="{ width: translationBarWidth(lang.machine) }"
            />
          </div>
          <div class="flex gap-4 mt-2 text-xs text-white/50">
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full bg-button-accent-main" />
              Official {{ translationPercent(lang.human) }}%
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full nd-accent-bg-muted" />
              DeepL {{ translationPercent(lang.machine) }}%
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full bg-white/10" />
              None {{ translationNonePercent(lang.human, lang.machine) }}%
            </span>
          </div>
        </div>
      </div>
    </div>

    <ClientOnly>
      <div v-if="userStore().isAdmin" class="max-w-xl">
        <h2 class="text-lg font-semibold mb-3">Admin: Update Coverage</h2>

        <div class="dark:bg-card-background rounded-lg px-5 py-5">
          <div class="flex gap-3">
            <button
              :disabled="updating"
              class="px-4 py-2 rounded text-sm font-medium transition-colors"
              :class="updating
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-button-accent-main hover:bg-button-accent-hover text-white'"
              @click="triggerUpdate(false)"
            >
              {{ updating ? 'Updating...' : 'Full rescan' }}
            </button>
            <button
              :disabled="updating"
              class="px-4 py-2 rounded text-sm font-medium transition-colors"
              :class="updating
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-button-primary-main hover:bg-button-primary-hover text-white'"
              @click="triggerUpdate(true)"
            >
              {{ updating ? 'Updating...' : 'Check missing only' }}
            </button>
          </div>

          <div v-if="updateResult" class="mt-4 text-sm space-y-1">
            <p>Words checked: <span class="text-white font-medium">{{ updateResult.wordsChecked.toLocaleString() }}</span></p>
            <p>Newly covered: <span class="text-button-accent-main font-medium">+{{ updateResult.newlyCovered.toLocaleString() }}</span></p>
            <p>Total covered: <span class="text-white font-medium">{{ updateResult.totalCovered.toLocaleString() }}</span> ({{ updateResult.percentage }}%)</p>
          </div>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>
