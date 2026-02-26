<script setup lang="ts">
type DashboardData = {
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
    totalCollectionAdds: number;
    activeSearchers7d: number;
    topQueries7d: Array<{ query: string; count: number }>;
    dailyActivity30d: Array<{ date: string; count: number }>;
  };
  system: {
    status: 'healthy' | 'degraded';
    app: { version: string };
    elasticsearch: {
      status: 'connected' | 'disconnected';
      version: string | null;
      clusterName: string | null;
      clusterStatus: string | null;
      indexName: string | null;
      documentCount: number | null;
    };
    database: {
      status: 'connected' | 'disconnected';
      version: string | null;
    };
    queues: Array<{ queue: string; stuckCount: number; failedCount: number }>;
  };
};

const isLoading = ref(false);
const sdk = useNadeshikoSdk();

const { data, refresh } = await useAsyncData('settings-admin-dashboard', async () => {
  const { data } = await sdk.getAdminDashboard().catch(() => ({ data: null }));
  return (data ?? null) as DashboardData | null;
}, {
  default: () => null,
});

const fetchDashboard = async () => {
  isLoading.value = true;
  await refresh();
  isLoading.value = false;
};

const statusBadgeClass = (status: string) => {
  return status === 'connected' || status === 'healthy' || status === 'green'
    ? 'bg-green-500/20 text-green-400 border-green-600'
    : 'bg-red-500/20 text-red-400 border-red-600';
};

const formatNumber = (n: number) => {
  return n.toLocaleString();
};
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold text-white">Dashboard</h1>
      <button
        :disabled="isLoading"
        class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600 disabled:opacity-50"
        @click="fetchDashboard"
      >
        {{ isLoading ? 'Refreshing...' : 'Refresh' }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading && !data" class="text-center py-12">
      <div
        class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full"
        role="status"
      />
    </div>

    <template v-if="data?.media && data?.activity && data?.users && data?.system">
      <!-- Media Section -->
      <h2 class="text-lg font-semibold text-white/90 mb-3">Media</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Total Media</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.media.totalMedia) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Episodes</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.media.totalEpisodes) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Total Segments</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.media.totalSegments) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Characters</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.media.totalCharacters) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Seiyuu</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.media.totalSeiyuu) }}</div>
        </div>
      </div>

      <!-- Users Section -->
      <h2 class="text-lg font-semibold text-white/90 mb-3">Users</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Total Users</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.users.totalUsers) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Registered (30d)</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.users.recentlyRegisteredCount) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Recently Active (30d)</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.users.recentlyActiveCount) }}</div>
        </div>
      </div>

      <!-- Activity Section -->
      <h2 class="text-lg font-semibold text-white/90 mb-3">Activity</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Total Searches</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.activity.totalSearches) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Anki Exports</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.activity.totalExports) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Segment Plays</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.activity.totalPlays) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Collection Adds</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.activity.totalCollectionAdds) }}</div>
        </div>
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400">Active Searchers (7d)</div>
          <div class="text-2xl font-bold text-white mt-1">{{ formatNumber(data.activity.activeSearchers7d) }}</div>
        </div>
      </div>

      <!-- Daily Activity Chart -->
      <div v-if="data.activity.dailyActivity30d.length > 0" class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-4">
        <div class="text-sm text-gray-400 mb-3">Daily Activity (30 days)</div>
        <div class="flex items-end gap-px h-24">
          <div
            v-for="day in data.activity.dailyActivity30d"
            :key="day.date"
            :title="`${day.date}: ${day.count}`"
            class="flex-1 bg-blue-500/70 rounded-t hover:bg-blue-400/90 transition-colors min-w-[4px]"
            :style="{ height: `${Math.max(4, (day.count / Math.max(...data.activity.dailyActivity30d.map(d => d.count))) * 100)}%` }"
          />
        </div>
        <div class="flex justify-between text-xs text-gray-500 mt-1">
          <span>{{ data.activity.dailyActivity30d[0]?.date }}</span>
          <span>{{ data.activity.dailyActivity30d[data.activity.dailyActivity30d.length - 1]?.date }}</span>
        </div>
      </div>

      <!-- Top Queries -->
      <div v-if="data.activity.topQueries7d.length > 0" class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 mb-6">
        <div class="text-sm text-gray-400 mb-3">Top Searches (7 days)</div>
        <div class="space-y-2">
          <div
            v-for="(q, i) in data.activity.topQueries7d"
            :key="q.query"
            class="flex items-center justify-between text-sm"
          >
            <div class="flex items-center gap-2">
              <span class="text-gray-500 w-5 text-right font-mono text-xs">{{ i + 1 }}</span>
              <span class="text-gray-200 font-mono">{{ q.query }}</span>
            </div>
            <span class="text-gray-400 font-mono text-xs">{{ q.count }}</span>
          </div>
        </div>
      </div>

      <!-- System Section -->
      <h2 class="text-lg font-semibold text-white/90 mb-3">System</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <!-- Overall Status -->
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm text-gray-400">Overall Status</div>
            <span
              class="px-2 py-1 text-xs font-medium rounded border"
              :class="statusBadgeClass(data.system.status)"
            >
              {{ data.system.status.toUpperCase() }}
            </span>
          </div>
          <div class="text-sm text-gray-400">
            App Version: <span class="text-white font-mono">{{ data.system.app.version }}</span>
          </div>
        </div>

        <!-- Database -->
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm text-gray-400">Database</div>
            <span
              class="px-2 py-1 text-xs font-medium rounded border"
              :class="statusBadgeClass(data.system.database.status)"
            >
              {{ data.system.database.status.toUpperCase() }}
            </span>
          </div>
          <div v-if="data.system.database.version" class="text-sm text-gray-400">
            Version: <span class="text-white font-mono">{{ data.system.database.version }}</span>
          </div>
        </div>

        <!-- Elasticsearch -->
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-sm text-gray-400">Elasticsearch</div>
            <span
              class="px-2 py-1 text-xs font-medium rounded border"
              :class="statusBadgeClass(data.system.elasticsearch.status)"
            >
              {{ data.system.elasticsearch.status.toUpperCase() }}
            </span>
          </div>
          <template v-if="data.system.elasticsearch.status === 'connected'">
            <div class="space-y-1 text-sm text-gray-400">
              <div>Version: <span class="text-white font-mono">{{ data.system.elasticsearch.version }}</span></div>
              <div>Cluster: <span class="text-white">{{ data.system.elasticsearch.clusterName }}</span>
                <span
                  v-if="data.system.elasticsearch.clusterStatus"
                  class="ml-1 px-1.5 py-0.5 text-xs rounded border"
                  :class="statusBadgeClass(data.system.elasticsearch.clusterStatus)"
                >
                  {{ data.system.elasticsearch.clusterStatus }}
                </span>
              </div>
              <div>Index: <span class="text-white font-mono">{{ data.system.elasticsearch.indexName }}</span></div>
              <div>Documents: <span class="text-white font-mono">{{ data.system.elasticsearch.documentCount != null ? formatNumber(data.system.elasticsearch.documentCount) : '-' }}</span></div>
            </div>
          </template>
        </div>

        <!-- Queues -->
        <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
          <div class="text-sm text-gray-400 mb-2">Queues</div>
          <div v-if="data.system.queues.length === 0" class="text-sm text-gray-500">No queues</div>
          <div class="space-y-2">
            <div
              v-for="q in data.system.queues"
              :key="q.queue"
              class="flex items-center justify-between text-sm"
            >
              <span class="text-gray-300 font-mono text-xs">{{ q.queue }}</span>
              <div class="flex gap-3">
                <span :class="q.stuckCount > 0 ? 'text-yellow-400' : 'text-gray-500'">
                  {{ q.stuckCount }} stuck
                </span>
                <span :class="q.failedCount > 0 ? 'text-red-400' : 'text-gray-500'">
                  {{ q.failedCount }} failed
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
