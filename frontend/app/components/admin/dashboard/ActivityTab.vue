<script setup lang="ts">
import { Line, Bar } from 'vue-chartjs';
import { CHART_COLORS } from '~/utils/chartColors';

type DailyByType = {
  date: string;
  search: number;
  ankiExport: number;
  segmentPlay: number;
  share: number;
};

type ActivityData = {
  dailyActivityByType: DailyByType[];
  topSearches: Array<{ query: string; count: number }>;
  dailyExports: Array<{ date: string; count: number }>;
  topExportedMedia: Array<{ mediaId: number; mediaName: string; count: number }>;
};

const props = defineProps<{ days: number }>();

const { data, status, refresh } = useLazyAsyncData(
  'admin-activity',
  () => $fetch<ActivityData>('/v1/admin/dashboard/activity', { query: { days: props.days } }),
  { default: () => null as ActivityData | null, watch: [() => props.days], server: false },
);

const stackedChartData = computed(() => {
  if (!data.value) return null;
  const items = data.value.dailyActivityByType;
  return {
    labels: items.map((d) => d.date.slice(5)),
    datasets: [
      { label: 'Search', data: items.map((d) => d.search), backgroundColor: CHART_COLORS[0], stack: 'stack' },
      { label: 'Export', data: items.map((d) => d.ankiExport), backgroundColor: CHART_COLORS[1], stack: 'stack' },
      { label: 'Play', data: items.map((d) => d.segmentPlay), backgroundColor: CHART_COLORS[2], stack: 'stack' },
      { label: 'Share', data: items.map((d) => d.share), backgroundColor: CHART_COLORS[3], stack: 'stack' },
    ],
  };
});

const exportChartData = computed(() => {
  if (!data.value) return null;
  const items = data.value.dailyExports;
  return {
    labels: items.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: 'Exports',
        data: items.map((d) => d.count),
        borderColor: CHART_COLORS[1],
        backgroundColor: CHART_COLORS[1]?.replace('rgb(', 'rgba(').replace(')', ', 0.1)'),
        fill: true,
        tension: 0.3,
        pointRadius: 1,
      },
    ],
  };
});

const stackedOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { boxWidth: 12, padding: 8 } } },
  scales: {
    x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
  },
};

const lineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { beginAtZero: true, ticks: { precision: 0 } },
  },
};

const fmt = (n: number) => n.toLocaleString();

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load activity data.</div>
  <div v-else-if="data">
    <ClientOnly>
      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6">
        <div class="text-sm text-gray-400 mb-3">Daily Activity by Type ({{ days }} days)</div>
        <div class="h-64">
          <Bar v-if="stackedChartData" :data="stackedChartData" :options="stackedOptions" />
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6">
        <div class="text-sm text-gray-400 mb-3">Export Volume ({{ days }} days)</div>
        <div class="h-48">
          <Line v-if="exportChartData" :data="exportChartData" :options="lineOptions" />
        </div>
      </div>
    </ClientOnly>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">Top Searches ({{ days }}d)</div>
        <div v-if="data.topSearches.length === 0" class="text-sm text-gray-500">No searches</div>
        <div class="space-y-2">
          <div v-for="(q, i) in data.topSearches" :key="q.query" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <span class="text-gray-500 w-5 text-right font-mono text-xs">{{ i + 1 }}</span>
              <span class="text-gray-200 font-mono">{{ q.query }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs">{{ fmt(q.count) }}</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">Most Exported Media ({{ days }}d)</div>
        <div v-if="data.topExportedMedia.length === 0" class="text-sm text-gray-500">No exports</div>
        <div class="space-y-2">
          <div v-for="(m, i) in data.topExportedMedia" :key="m.mediaId" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-gray-500 w-5 text-right font-mono text-xs shrink-0">{{ i + 1 }}</span>
              <span class="text-gray-200 truncate">{{ m.mediaName }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs shrink-0 ml-2">{{ fmt(m.count) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
