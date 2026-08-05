<script setup lang="ts">
import { ALL_STATUSES, statusClass } from './reportHelpers';

defineProps<{
  source: '' | 'USER' | 'AUTO';
  activeStatuses: Set<string>;
  orphaned: boolean;
}>();

const emit = defineEmits<{
  'update:source': [source: '' | 'USER' | 'AUTO'];
  'update:orphaned': [orphaned: boolean];
  'toggle-status': [status: string];
}>();

const { t } = useI18n();

const statusLabel = (status: string) => t(`reports.statuses.${status}`);
</script>

<template>
  <div class="flex flex-wrap items-center gap-3 mb-4">
    <div class="flex rounded-lg border border-neutral-600 overflow-hidden">
      <button
        class="px-3 py-2 text-sm"
        :class="source === '' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="emit('update:source', '')"
      >
        {{ t('reports.admin.filters.all') }}
      </button>
      <button
        class="px-3 py-2 text-sm border-l border-neutral-600"
        :class="source === 'USER' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="emit('update:source', 'USER')"
      >
        {{ t('reports.admin.filters.user') }}
      </button>
      <button
        class="px-3 py-2 text-sm border-l border-neutral-600"
        :class="source === 'AUTO' ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-gray-400 hover:text-white'"
        @click="emit('update:source', 'AUTO')"
      >
        {{ t('reports.admin.filters.auto') }}
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="status in ALL_STATUSES"
        :key="status"
        class="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all duration-150 cursor-pointer"
        :class="activeStatuses.has(status) ? statusClass(status) : 'border-neutral-700 text-neutral-600 bg-neutral-800/50'"
        @click="emit('toggle-status', status)"
      >
        {{ statusLabel(status) }}
      </button>
    </div>

    <button
      class="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-all duration-150 cursor-pointer"
      :class="orphaned ? 'bg-red-500/20 text-red-400 border-red-600' : 'border-neutral-700 text-neutral-600 bg-neutral-800/50'"
      data-testid="orphaned-filter"
      @click="emit('update:orphaned', !orphaned)"
    >
      {{ t('reports.admin.filters.orphaned') }}
    </button>
  </div>
</template>
