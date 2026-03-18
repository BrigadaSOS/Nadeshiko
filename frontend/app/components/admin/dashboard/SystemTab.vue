<script setup lang="ts">
import type { GetAdminDashboardSystemResponse } from '@brigadasos/nadeshiko-sdk';

const sdk = useNadeshikoSdk();
const { data, status, refresh } = useLazyAsyncData(
  'admin-system',
  async () => {
    const { data } = await sdk.getAdminDashboardSystem();
    return data ?? null;
  },
  { default: () => null as GetAdminDashboardSystemResponse | null, server: false },
);

const statusBadgeClass = (status: string) => {
  return status === 'connected' || status === 'healthy' || status === 'green'
    ? 'bg-green-500/20 text-green-400 border-green-600'
    : 'bg-red-500/20 text-red-400 border-red-600';
};

const fmt = (n: number) => n.toLocaleString();

function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load system data.</div>
  <div v-else-if="data">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm text-gray-400">Overall Status</div>
          <span
            class="px-2 py-1 text-xs font-medium rounded border"
            :class="statusBadgeClass(data.status)"
          >
            {{ data.status.toUpperCase() }}
          </span>
        </div>
        <div class="text-sm text-gray-400">
          App Version: <span class="text-white font-mono">{{ data.app.version }}</span>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm text-gray-400">Database</div>
          <span
            class="px-2 py-1 text-xs font-medium rounded border"
            :class="statusBadgeClass(data.database.status)"
          >
            {{ data.database.status.toUpperCase() }}
          </span>
        </div>
        <div v-if="data.database.version" class="text-sm text-gray-400">
          Version: <span class="text-white font-mono">{{ data.database.version }}</span>
        </div>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="flex items-center justify-between mb-2">
          <div class="text-sm text-gray-400">Elasticsearch</div>
          <span
            class="px-2 py-1 text-xs font-medium rounded border"
            :class="statusBadgeClass(data.elasticsearch.status)"
          >
            {{ data.elasticsearch.status.toUpperCase() }}
          </span>
        </div>
        <template v-if="data.elasticsearch.status === 'connected'">
          <div class="space-y-1 text-sm text-gray-400">
            <div>Version: <span class="text-white font-mono">{{ data.elasticsearch.version }}</span></div>
            <div>
              Cluster: <span class="text-white">{{ data.elasticsearch.clusterName }}</span>
              <span
                v-if="data.elasticsearch.clusterStatus"
                class="ml-1 px-1.5 py-0.5 text-xs rounded border"
                :class="statusBadgeClass(data.elasticsearch.clusterStatus)"
              >
                {{ data.elasticsearch.clusterStatus }}
              </span>
            </div>
            <div>Index: <span class="text-white font-mono">{{ data.elasticsearch.indexName }}</span></div>
            <div>Documents: <span class="text-white font-mono">{{ data.elasticsearch.documentCount != null ? fmt(data.elasticsearch.documentCount) : '-' }}</span></div>
            <div>Index Size: <span class="text-white font-mono">{{ formatBytes(data.elasticsearch.indexSizeBytes) }}</span></div>
          </div>
        </template>
      </div>

      <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
        <div class="text-sm text-gray-400 mb-2">Queues</div>
        <div v-if="data.queues.length === 0" class="text-sm text-gray-500">No queues</div>
        <div class="space-y-2">
          <div
            v-for="q in data.queues"
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
  </div>
</template>
