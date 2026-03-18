<script setup lang="ts">
import { Doughnut } from 'vue-chartjs';
import { CHART_COLORS, CHART_COLORS_ALPHA } from '~/utils/chartColors';

type CollectionsData = {
  totalCollections: number;
  byTypeAndVisibility: Array<{ type: string; visibility: string; count: number }>;
  averageSize: number;
  topCollections: Array<{ id: number; name: string; type: string; visibility: string; segmentCount: number }>;
};

const { data, status, refresh } = useLazyAsyncData(
  'admin-collections',
  () => $fetch<CollectionsData>('/v1/admin/dashboard/collections'),
  { default: () => null as CollectionsData | null, server: false },
);

const doughnutData = computed(() => {
  if (!data.value) return null;
  const items = data.value.byTypeAndVisibility;
  return {
    labels: items.map((i) => `${i.type} / ${i.visibility}`),
    datasets: [
      {
        data: items.map((i) => i.count),
        backgroundColor: CHART_COLORS_ALPHA.slice(0, items.length),
        borderColor: CHART_COLORS.slice(0, items.length),
        borderWidth: 1,
      },
    ],
  };
});

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'right' as const, labels: { boxWidth: 12, padding: 8 } } },
};

const fmt = (n: number) => n.toLocaleString();

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load collection stats.</div>
  <div v-else-if="data">
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <AdminDashboardStatCard label="Total Collections" :value="data.totalCollections" />
      <AdminDashboardStatCard label="Average Size" :value="data.averageSize" format="decimal" subtitle="segments per collection" />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <ClientOnly>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-3">By Type & Visibility</div>
          <div class="h-48">
            <Doughnut v-if="doughnutData" :data="doughnutData" :options="doughnutOptions" />
          </div>
        </div>
      </ClientOnly>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-3">Top Collections</div>
        <div v-if="data.topCollections.length === 0" class="text-sm text-gray-500">No collections</div>
        <div class="space-y-2">
          <div v-for="(c, i) in data.topCollections" :key="c.id" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-gray-500 w-5 text-right font-mono text-xs shrink-0">{{ i + 1 }}</span>
              <span class="text-gray-200 truncate">{{ c.name }}</span>
              <span class="text-xs text-gray-500">{{ c.type }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs shrink-0 ml-2">{{ fmt(c.segmentCount) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
