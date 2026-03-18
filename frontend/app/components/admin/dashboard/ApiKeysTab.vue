<script setup lang="ts">
import type { GetAdminDashboardApiKeysResponse } from '@brigadasos/nadeshiko-sdk';

const sdk = useNadeshikoSdk();
const { data, status, refresh } = useLazyAsyncData(
  'admin-api-keys',
  async () => {
    const { data } = await sdk.getAdminDashboardApiKeys();
    return data ?? null;
  },
  { default: () => null as GetAdminDashboardApiKeysResponse | null, server: false },
);

const fmt = (n: number) => n.toLocaleString();

defineExpose({ refresh });
</script>

<template>
  <div v-if="status === 'pending'" class="text-center py-12">
    <div class="animate-spin inline-block w-6 h-6 border-[3px] border-current border-t-transparent text-white rounded-full" role="status" />
  </div>
  <div v-else-if="status === 'error'" class="text-red-400 text-sm py-4">Failed to load API key data.</div>
  <div v-else-if="data">
    <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-neutral-700 text-left text-gray-400">
            <th class="px-4 py-3 font-medium">Name</th>
            <th class="px-4 py-3 font-medium">Hint</th>
            <th class="px-4 py-3 font-medium">User</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium text-right">Requests (this month)</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="key in data.keys"
            :key="key.id"
            class="border-b border-neutral-700/50 last:border-0"
          >
            <td class="px-4 py-3 text-gray-200">{{ key.name || '-' }}</td>
            <td class="px-4 py-3 text-gray-400 font-mono text-xs">{{ key.hint || '-' }}</td>
            <td class="px-4 py-3 text-gray-300">
              <div>{{ key.username || '-' }}</div>
              <div v-if="key.email" class="text-xs text-gray-500">{{ key.email }}</div>
            </td>
            <td class="px-4 py-3">
              <span
                class="px-2 py-1 text-xs font-medium rounded border"
                :class="key.isActive
                  ? 'bg-green-500/20 text-green-400 border-green-600'
                  : 'bg-red-500/20 text-red-400 border-red-600'"
              >
                {{ key.isActive ? 'ACTIVE' : 'INACTIVE' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right text-gray-200 font-mono">{{ fmt(key.requestCount) }}</td>
          </tr>
          <tr v-if="data.keys.length === 0">
            <td colspan="5" class="px-4 py-6 text-center text-gray-500">No API keys</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
