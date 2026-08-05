<script setup lang="ts">
import { formatNumber } from './reportHelpers';

defineProps<{
  count: number;
  isUpdating: boolean;
}>();

const emit = defineEmits<{
  update: [status: string];
  delete: [];
  clear: [];
}>();

const { t, locale } = useI18n();

const statusLabel = (status: string) => t(`reports.statuses.${status}`);
</script>

<template>
  <div class="flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg border border-neutral-600 bg-neutral-800/80">
    <span class="text-sm text-white font-medium">{{ t('reports.admin.selectedGroups', { count: formatNumber(count, locale) }) }}</span>
    <div class="flex gap-1.5 ml-2">
      <button :disabled="isUpdating" class="px-2.5 py-1 text-xs rounded bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/50 disabled:opacity-50" @click="emit('update', 'OPEN')">{{ statusLabel('OPEN') }}</button>
      <button :disabled="isUpdating" class="px-2.5 py-1 text-xs rounded bg-blue-600/30 text-blue-400 hover:bg-blue-600/50 disabled:opacity-50" @click="emit('update', 'PROCESSING')">{{ statusLabel('PROCESSING') }}</button>
      <button :disabled="isUpdating" class="px-2.5 py-1 text-xs rounded bg-green-600/30 text-green-400 hover:bg-green-600/50 disabled:opacity-50" @click="emit('update', 'FIXED')">{{ statusLabel('FIXED') }}</button>
      <button :disabled="isUpdating" class="px-2.5 py-1 text-xs rounded bg-neutral-600/30 text-neutral-400 hover:bg-neutral-600/50 disabled:opacity-50" @click="emit('update', 'DISMISSED')">{{ t('reports.admin.dismiss') }}</button>
      <button :disabled="isUpdating" class="px-2.5 py-1 text-xs rounded bg-red-600/30 text-red-400 hover:bg-red-600/50 disabled:opacity-50" @click="emit('delete')">{{ t('reports.admin.delete') }}</button>
    </div>
    <button class="ml-auto text-xs text-gray-500 hover:text-white" @click="emit('clear')">{{ t('reports.admin.clearSelection') }}</button>
  </div>
</template>
