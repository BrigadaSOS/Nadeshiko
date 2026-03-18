<script setup lang="ts">
import type { GetAdminDashboardMediaResponse } from '@brigadasos/nadeshiko-sdk';
import { Bar, Doughnut } from 'vue-chartjs';
import { CHART_COLORS, CHART_COLORS_ALPHA } from '~/utils/chartColors';

const sdk = useNadeshikoSdk();
const { data, status, refresh } = useLazyAsyncData(
  'admin-media',
  async () => {
    const { data } = await sdk.getAdminDashboardMedia();
    return data ?? null;
  },
  { default: () => null as GetAdminDashboardMediaResponse | null, server: false },
);

function makeDoughnutData(items: Array<{ label: string; count: number }>) {
  return {
    labels: items.map((i) => i.label),
    datasets: [
      {
        data: items.map((i) => i.count),
        backgroundColor: CHART_COLORS_ALPHA.slice(0, items.length),
        borderColor: CHART_COLORS.slice(0, items.length),
        borderWidth: 1,
      },
    ],
  };
}

function makeBarData(items: Array<{ label: string; count: number }>) {
  return {
    labels: items.map((i) => i.label),
    datasets: [
      {
        data: items.map((i) => i.count),
        backgroundColor: CHART_COLORS[0],
        borderRadius: 2,
      },
    ],
  };
}

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12, padding: 8 } } },
};

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: { legend: { display: false } },
  scales: {
    x: { beginAtZero: true, ticks: { precision: 0 } },
    y: { grid: { display: false } },
  },
};

const fmt = (n: number) => n.toLocaleString();

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load media data.</div>
  <div v-else-if="data">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <ClientOnly>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">By Category</div>
          <div class="h-48">
            <Doughnut :data="makeDoughnutData(data.byCategory)" :options="doughnutOptions" />
          </div>
        </div>

        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">By Airing Status</div>
          <div class="h-48">
            <Doughnut :data="makeDoughnutData(data.byStatus)" :options="doughnutOptions" />
          </div>
        </div>
      </ClientOnly>
    </div>

    <ClientOnly>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">By Format</div>
          <div class="h-48">
            <Bar :data="makeBarData(data.byFormat)" :options="barOptions" />
          </div>
        </div>

        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">Segments by Content Rating</div>
          <div class="h-48">
            <Doughnut :data="makeDoughnutData(data.segmentsByContentRating)" :options="doughnutOptions" />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">Segments by Status</div>
          <div class="h-48">
            <Doughnut :data="makeDoughnutData(data.segmentsByStatus)" :options="doughnutOptions" />
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6">
        <div class="text-sm text-gray-400 mb-3">Top Genres</div>
        <div :style="{ height: `${Math.max(200, data.byGenre.length * 28)}px` }">
          <Bar :data="makeBarData(data.byGenre)" :options="barOptions" />
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6">
        <div class="text-sm text-gray-400 mb-3">Top Studios</div>
        <div :style="{ height: `${Math.max(200, data.byStudio.length * 28)}px` }">
          <Bar :data="makeBarData(data.byStudio)" :options="barOptions" />
        </div>
      </div>
    </ClientOnly>

    <h2 class="text-lg font-semibold text-white/90 mb-3">Top Media by Interaction</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">By Plays</div>
        <div class="space-y-2">
          <div v-for="(m, i) in data.topMediaByPlays" :key="m.mediaId" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-gray-500 w-5 text-right font-mono text-xs shrink-0">{{ i + 1 }}</span>
              <span class="text-gray-200 truncate">{{ m.mediaName }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs shrink-0 ml-2">{{ fmt(m.count) }}</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">By Searches</div>
        <div class="space-y-2">
          <div v-for="(m, i) in data.topMediaBySearches" :key="m.mediaId" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-gray-500 w-5 text-right font-mono text-xs shrink-0">{{ i + 1 }}</span>
              <span class="text-gray-200 truncate">{{ m.mediaName }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs shrink-0 ml-2">{{ fmt(m.count) }}</span>
          </div>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">By Exports</div>
        <div class="space-y-2">
          <div v-for="(m, i) in data.topMediaByExports" :key="m.mediaId" class="flex items-center justify-between text-sm">
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
