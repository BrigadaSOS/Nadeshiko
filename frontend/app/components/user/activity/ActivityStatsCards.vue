<script setup lang="ts">
import type { ActivityStats, StatsRange } from './activityHelpers';

defineProps<{
  stats: ActivityStats | null;
  range: StatsRange;
}>();

const emit = defineEmits<{
  'update:range': [range: StatsRange];
}>();

const { t } = useI18n();
const { formatNumber } = useFormat();
</script>

<template>
  <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md border border-white/10">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ t('accountSettings.activity.overview.title') }}</h3>
        <p class="text-sm text-gray-400 mt-1">{{ t('accountSettings.activity.overview.description') }}</p>
      </div>
      <div class="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
        <button
          v-for="option in (['7d', '30d', '90d', 'all'] as const)"
          :key="option"
          :class="[
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            range === option
              ? 'bg-red-500/80 text-white'
              : 'text-gray-400 hover:text-white hover:bg-white/10',
          ]"
          @click="emit('update:range', option)"
        >
          {{ option === 'all' ? t('accountSettings.activity.ranges.all') : option }}
        </button>
      </div>
    </div>

    <div class="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-red-400/20 bg-red-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-red-300/70">{{ t('accountSettings.activity.metrics.searches') }}</p>
        <p class="mt-2 text-2xl font-semibold text-red-200">{{ formatNumber(stats?.totalSearches ?? 0) }}</p>
      </div>
      <div class="rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-emerald-300/70">{{ t('accountSettings.activity.metrics.plays') }}</p>
        <p class="mt-2 text-2xl font-semibold text-emerald-200">{{ formatNumber(stats?.totalPlays ?? 0) }}</p>
      </div>
      <div class="rounded-lg border border-blue-400/20 bg-blue-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-blue-300/70">{{ t('accountSettings.activity.metrics.exports') }}</p>
        <p class="mt-2 text-2xl font-semibold text-blue-200">{{ formatNumber(stats?.totalExports ?? 0) }}</p>
      </div>
      <div class="rounded-lg border border-purple-400/20 bg-purple-500/5 p-4">
        <p class="text-xs uppercase tracking-wide text-purple-300/70">{{ t('accountSettings.activity.metrics.shares') }}</p>
        <p class="mt-2 text-2xl font-semibold text-purple-200">{{ formatNumber(stats?.totalShares ?? 0) }}</p>
      </div>
    </div>
  </div>
</template>
