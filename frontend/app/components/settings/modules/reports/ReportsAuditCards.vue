<script setup lang="ts">
import type { MediaAudit } from '@brigadasos/nadeshiko-sdk';
import { formatRelativeDate } from './reportHelpers';

defineProps<{
  audits: MediaAudit[];
  runningAudits: Set<string>;
}>();

const emit = defineEmits<{
  configure: [audit: MediaAudit];
  run: [auditName: string];
}>();

const { t, locale } = useI18n();
</script>

<template>
  <div class="mb-4">
    <div class="mb-3">
      <span class="text-sm text-gray-400">{{ t('reports.admin.availableChecks') }}</span>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <div
        v-for="audit in audits"
        :key="audit.name"
        class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4 transition-colors"
      >
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-white truncate">{{ audit.label }}</span>
            </div>
            <p class="text-xs text-gray-500 mt-0.5 line-clamp-2">{{ audit.description }}</p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              class="p-1.5 rounded text-gray-500 hover:text-white hover:bg-neutral-700 transition-colors"
              :title="t('reports.admin.configure')"
              @click="emit('configure', audit)"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              :disabled="runningAudits.has(audit.name)"
              class="px-2.5 py-1 text-xs rounded bg-cyan-600/80 text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="emit('run', audit.name)"
            >
              <span v-if="runningAudits.has(audit.name)" class="flex items-center gap-1">
                <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
                {{ t('reports.admin.running') }}
              </span>
              <span v-else>{{ t('reports.admin.run') }}</span>
            </button>
          </div>
        </div>

        <div class="mt-2 pt-2 border-t border-neutral-700/50">
          <span v-if="audit.latestRun" class="text-xs text-gray-500">{{ t('reports.admin.lastRun', { date: formatRelativeDate(audit.latestRun.createdAt, locale) }) }}</span>
          <span v-else class="text-xs text-gray-600">{{ t('reports.admin.neverRun') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
