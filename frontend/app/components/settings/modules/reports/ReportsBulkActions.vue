<script setup lang="ts">
defineProps<{
  isDismissing: boolean;
  isDeleting: boolean;
  hasResults: boolean;
}>();

const emit = defineEmits<{
  'dismiss-all': [];
  'delete-all': [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex justify-end gap-2 mb-3">
    <button
      :disabled="isDismissing || !hasResults"
      class="px-3 py-1.5 text-xs rounded-lg border border-neutral-600 text-neutral-400 hover:text-white hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="emit('dismiss-all')"
    >
      <span v-if="isDismissing" class="flex items-center gap-1.5">
        <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
        {{ t('reports.admin.dismissingAll') }}
      </span>
      <span v-else>{{ t('reports.admin.dismissAllMatching') }}</span>
    </button>
    <button
      :disabled="isDeleting || !hasResults"
      class="px-3 py-1.5 text-xs rounded-lg border border-red-800 text-red-400 hover:text-red-300 hover:border-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
      @click="emit('delete-all')"
    >
      <span v-if="isDeleting" class="flex items-center gap-1.5">
        <span class="animate-spin inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
        {{ t('reports.admin.deletingAll') }}
      </span>
      <span v-else>{{ t('reports.admin.deleteAllMatching') }}</span>
    </button>
  </div>
</template>
