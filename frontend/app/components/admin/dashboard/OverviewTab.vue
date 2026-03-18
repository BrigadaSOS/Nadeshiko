<script setup lang="ts">
import { Bar } from 'vue-chartjs';
import { CHART_COLORS } from '~/utils/chartColors';

type OverviewData = {
  media: {
    totalMedia: number;
    totalEpisodes: number;
    totalSegments: number;
    totalCharacters: number;
    totalSeiyuu: number;
  };
  users: {
    totalUsers: number;
    recentlyRegisteredCount: number;
    recentlyActiveCount: number;
  };
  activity: {
    totalSearches: number;
    totalExports: number;
    totalPlays: number;
    totalShares: number;
    activeSearchers7d: number;
    dailyActivity: Array<{ date: string; count: number }>;
  };
};

const props = defineProps<{ days: number }>();

const { data, status, refresh } = useLazyAsyncData(
  'admin-overview',
  () => $fetch<OverviewData>('/v1/admin/dashboard/overview', { query: { days: props.days } }),
  { default: () => null as OverviewData | null, watch: [() => props.days], server: false },
);

const fmt = (n: number) => n.toLocaleString();
const fmtDec = (n: number) => n.toFixed(1);

const chartData = computed(() => {
  if (!data.value) return null;
  const activity = data.value.activity.dailyActivity;
  return {
    labels: activity.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: 'Activity',
        data: activity.map((d) => d.count),
        backgroundColor: CHART_COLORS[0],
        borderRadius: 2,
      },
    ],
  };
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
    y: { beginAtZero: true, ticks: { precision: 0 } },
  },
};

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load overview data.</div>
  <div v-else-if="data">
    <h2 class="text-lg font-semibold text-white/90 mb-3">Media</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <AdminDashboardStatCard label="Total Media" :value="data.media.totalMedia" />
      <AdminDashboardStatCard
        label="Episodes"
        :value="data.media.totalEpisodes"
        :subtitle="`${fmtDec(data.media.totalMedia > 0 ? data.media.totalEpisodes / data.media.totalMedia : 0)} avg per show`"
      />
      <AdminDashboardStatCard
        label="Total Segments"
        :value="data.media.totalSegments"
        :subtitle="`${fmtDec(data.media.totalEpisodes > 0 ? data.media.totalSegments / data.media.totalEpisodes : 0)} avg per episode`"
      />
      <AdminDashboardStatCard label="Characters" :value="data.media.totalCharacters" />
      <AdminDashboardStatCard label="Seiyuu" :value="data.media.totalSeiyuu" />
    </div>

    <h2 class="text-lg font-semibold text-white/90 mb-3">Users</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <AdminDashboardStatCard label="Total Users" :value="data.users.totalUsers" />
      <AdminDashboardStatCard label="Registered (30d)" :value="data.users.recentlyRegisteredCount" />
      <AdminDashboardStatCard label="Recently Active (30d)" :value="data.users.recentlyActiveCount" />
    </div>

    <h2 class="text-lg font-semibold text-white/90 mb-3">Activity</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
      <AdminDashboardStatCard
        label="Total Searches"
        :value="data.activity.totalSearches"
        :subtitle="`${fmtDec(data.users.totalUsers > 0 ? data.activity.totalSearches / data.users.totalUsers : 0)} per user`"
      />
      <AdminDashboardStatCard label="Anki Exports" :value="data.activity.totalExports" />
      <AdminDashboardStatCard label="Segment Plays" :value="data.activity.totalPlays" />
      <AdminDashboardStatCard label="Shares" :value="data.activity.totalShares" />
      <AdminDashboardStatCard
        label="Active Searchers (7d)"
        :value="data.activity.activeSearchers7d"
        :subtitle="`of ${fmt(data.users.totalUsers)} total`"
      />
    </div>

    <ClientOnly>
      <div
        v-if="chartData && data.activity.dailyActivity.length > 0"
        class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6"
      >
        <div class="text-sm text-gray-400 mb-3">Daily Activity ({{ days }} days)</div>
        <div class="h-48">
          <Bar :data="chartData" :options="chartOptions" />
        </div>
      </div>
    </ClientOnly>
  </div>
</template>
