<script setup lang="ts">
import type { MediaAuditRun } from '@brigadasos/nadeshiko-sdk';

defineProps<{
  runs: MediaAuditRun[];
}>();

const emit = defineEmits<{
  'view-results': [];
}>();

const { t } = useI18n();
const { formatNumber, formatDate } = useFormat();
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-neutral-700">
    <table class="w-full text-sm text-left text-gray-300">
      <thead class="text-xs uppercase bg-neutral-800 text-gray-400">
        <tr>
          <th class="px-3 py-3">{{ t('reports.admin.runHistory.check') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.runHistory.category') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.runHistory.findings') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.runHistory.date') }}</th>
          <th class="px-3 py-3">{{ t('reports.admin.runHistory.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="run in runs"
          :key="run.id"
          class="border-b border-neutral-700 hover:bg-neutral-800/50"
        >
          <td class="px-3 py-3 text-sm font-medium text-white">{{ run.auditName }}</td>
          <td class="px-3 py-3 text-xs text-gray-400">{{ run.category || t('reports.admin.runHistory.allCategories') }}</td>
          <td class="px-3 py-3">
            <span class="px-2 py-1 text-xs font-bold rounded bg-neutral-700 text-white">
              {{ formatNumber(run.resultCount) }}
            </span>
          </td>
          <td class="px-3 py-3 text-xs text-gray-400">{{ formatDate(run.createdAt, 'dateTime') }}</td>
          <td class="px-3 py-3">
            <button
              class="text-xs text-cyan-400 hover:text-cyan-300"
              @click="emit('view-results')"
            >
              {{ t('reports.admin.runHistory.viewResults') }}
            </button>
          </td>
        </tr>
        <tr v-if="runs.length === 0">
          <td colspan="5" class="px-4 py-8 text-center text-gray-500">{{ t('reports.admin.runHistory.empty') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
