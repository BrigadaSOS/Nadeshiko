<script setup lang="ts">
import { userStore } from '~/stores/auth';
import type { GetStatsOverviewResponse, TriggerCoveredWordsUpdateResponse } from '@brigadasos/nadeshiko-sdk';

const { t, locale } = useI18n();
const localePath = useLocalePath();

useSeoMeta({
  title: () => t('seo.stats.title'),
  description: () => t('seo.stats.description'),
  ogTitle: () => t('seo.stats.title'),
  ogDescription: () => t('seo.stats.description'),
  ogImage: `${useRequestURL().origin}/logo-og-5bc76788.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => t('seo.stats.title'),
  twitterDescription: () => t('seo.stats.description'),
});

const sdk = useNadeshikoSdk();

const {
  data: stats,
  refresh: refreshStats,
  error: statsError,
} = await useAsyncData('stats-overview', async () => {
  return await sdk.getStatsOverview();
});

const updating = ref(false);
const updateResult = ref<TriggerCoveredWordsUpdateResponse | null>(null);

function formatNumber(value: number): string {
  return value.toLocaleString(locale.value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

async function triggerUpdate(onlyUncovered: boolean) {
  updating.value = true;
  updateResult.value = null;
  try {
    updateResult.value = await sdk.triggerCoveredWordsUpdate({ onlyUncovered });
    await refreshStats();
  } catch (err) {
    console.error('stats.coverage_update_failed', err);
  } finally {
    updating.value = false;
  }
}

function tierLabel(tier: number): string {
  if (stats.value && tier >= stats.value.totalFrequencyWords)
    return t('statsPage.coverage.fullCorpus', {
      count: (stats.value.totalFrequencyWords / 1000).toFixed(0),
    });
  if (tier >= 1000) {
    return t('statsPage.coverage.topWordsK', {
      count: (tier / 1000).toLocaleString(locale.value),
    });
  }
  return t('statsPage.coverage.topWords', { count: tier.toLocaleString(locale.value) });
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
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
  return formatPercent(Math.max(0, none));
}

function translationBarWidth(count: number): string {
  return `${(count / (stats.value?.translations?.total || 1)) * 100}%`;
}

const translationLanguages = computed(() => {
  const t = stats.value?.translations;
  if (!t) return [];
  return [
    { label: 'english', human: t.enHuman, machine: t.enMachine },
    { label: 'spanish', human: t.esHuman, machine: t.esMachine },
  ];
});
</script>

<template>
  <div class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6 text-white">
    <div class="mb-3">
      <h1 class="text-[2.5rem] font-extrabold mb-2 pl-4 leading-tight relative before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1 before:bg-button-accent-main before:rounded-sm">{{ $t('statsPage.title') }}</h1>
      <p class="text-white/50 max-w-xl">
        {{ $t('statsPage.intro.prefix') }}
        <a
          href="https://jiten.moe"
          target="_blank"
          rel="noopener"
          class="text-button-accent-main hover:text-button-accent-hover transition-colors"
        >{{ $t('statsPage.intro.source') }}</a>
        {{ $t('statsPage.intro.suffix', { totalWords: stats?.totalFrequencyWords ? formatNumber(stats.totalFrequencyWords) : '200,000+' }) }}
      </p>
    </div>

    <div v-if="statsError" class="dark:bg-card-background rounded-lg px-5 py-5 mb-3 text-center text-white/40 text-sm">
      {{ $t('statsPage.loadError') }}
    </div>

    <div v-if="stats" class="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-3 mb-3">
      <div class="flex flex-col gap-3">
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">{{ $t('statsPage.summary.sentences') }}</p>
          <p class="text-3xl font-bold tabular-nums">{{ formatNumber(stats.totalSegments) }}+</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">{{ $t('statsPage.summary.uniqueWords') }}</p>
          <p class="text-3xl font-bold tabular-nums text-button-accent-main">{{ formatNumber(totalWordsCovered) }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">{{ $t('statsPage.summary.totalContent') }}</p>
          <p class="text-3xl font-bold tabular-nums">{{ formatNumber(stats.totalMedia) }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">{{ $t('statsPage.summary.episodes') }}</p>
          <p class="text-3xl font-bold tabular-nums">{{ formatNumber(stats.totalEpisodes) }}</p>
        </div>
        <div class="dark:bg-card-background rounded-lg flex flex-col items-center justify-center py-6 flex-1">
          <p class="text-white/40 text-xs uppercase tracking-wider mb-1">{{ $t('statsPage.summary.dialogueHours') }}</p>
          <p class="text-3xl font-bold tabular-nums">{{ formatNumber(stats.dialogueHours) }}</p>
        </div>
      </div>

      <div class="dark:bg-card-background rounded-lg px-5 py-5">
        <div class="flex items-baseline justify-between mb-5">
          <h2 class="text-lg font-semibold">{{ $t('statsPage.coverage.title') }}</h2>
          <p v-if="stats?.lastUpdated" class="text-white/30 text-xs">
            {{ $t('statsPage.coverage.updated', { date: formatDate(stats.lastUpdated) }) }}
          </p>
        </div>

        <div v-if="stats?.tiers" class="space-y-3">
          <NuxtLink
            v-for="tier in stats.tiers"
            :key="tier.tier"
            :to="localePath(`/stats/words?tier=${tier.tier}`)"
            class="block group rounded-lg px-4 py-3 -mx-1 transition-colors hover:bg-white/[0.03]"
          >
            <div class="flex justify-between items-baseline mb-1.5">
              <span class="text-sm font-medium group-hover:text-white/90">
                {{ tierLabel(tier.tier) }}
              </span>
              <span class="text-sm">
                <span class="font-semibold tabular-nums text-button-accent-main">{{ formatNumber(tier.percentage) }}%</span>
                <span class="text-white/30 ml-2 text-xs tabular-nums">{{ formatNumber(tier.covered) }}/{{ formatNumber(tier.tier) }}</span>
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
          {{ $t('statsPage.coverage.empty') }}
        </div>
      </div>
    </div>

    <div v-if="stats?.translations" class="dark:bg-card-background rounded-lg px-5 py-5 mb-3">
      <div class="mb-5">
        <h2 class="text-lg font-semibold mb-1">{{ $t('statsPage.translations.title') }}</h2>
        <p class="text-white/40 text-sm max-w-2xl">
          {{ $t('statsPage.translations.description') }}
        </p>
      </div>

      <div class="space-y-5">
        <div v-for="lang in translationLanguages" :key="lang.label">
          <div class="flex justify-between items-baseline mb-2">
            <span class="text-sm font-medium">{{ $t(`statsPage.translations.languages.${lang.label}`) }}</span>
            <span class="text-xs text-white/40 tabular-nums">
              {{ $t('statsPage.translations.translated', { percent: formatPercent(translationPercent(lang.human) + translationPercent(lang.machine)) }) }}
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
              {{ $t('statsPage.translations.official', { percent: formatPercent(translationPercent(lang.human)) }) }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full nd-accent-bg-muted" />
              {{ $t('statsPage.translations.machine', { percent: formatPercent(translationPercent(lang.machine)) }) }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full bg-white/10" />
              {{ $t('statsPage.translations.none', { percent: translationNonePercent(lang.human, lang.machine) }) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <ClientOnly>
      <div v-if="userStore().isAdmin" class="max-w-xl">
        <h2 class="text-lg font-semibold mb-3">{{ $t('statsPage.admin.title') }}</h2>

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
              {{ updating ? $t('statsPage.admin.updating') : $t('statsPage.admin.fullRescan') }}
            </button>
            <button
              :disabled="updating"
              class="px-4 py-2 rounded text-sm font-medium transition-colors"
              :class="updating
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-button-primary-main hover:bg-button-primary-hover text-white'"
              @click="triggerUpdate(true)"
            >
              {{ updating ? $t('statsPage.admin.updating') : $t('statsPage.admin.missingOnly') }}
            </button>
          </div>

          <div v-if="updateResult" class="mt-4 text-sm space-y-1">
            <p>{{ $t('statsPage.admin.wordsChecked') }}: <span class="text-white font-medium">{{ formatNumber(updateResult.wordsChecked) }}</span></p>
            <p>{{ $t('statsPage.admin.newlyCovered') }}: <span class="text-button-accent-main font-medium">+{{ formatNumber(updateResult.newlyCovered) }}</span></p>
            <p>{{ $t('statsPage.admin.totalCovered') }}: <span class="text-white font-medium">{{ formatNumber(updateResult.totalCovered) }}</span> ({{ formatNumber(updateResult.percentage) }}%)</p>
          </div>
        </div>
      </div>
    </ClientOnly>
  </div>
</template>
