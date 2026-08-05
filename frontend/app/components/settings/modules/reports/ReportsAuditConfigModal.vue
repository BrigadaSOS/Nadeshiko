<script setup lang="ts">
import type { MediaAudit } from '@brigadasos/nadeshiko-sdk';

defineProps<{
  open: boolean;
  audit: MediaAudit | null;
  /** Draft threshold values, edited in place and read back by the parent on save. */
  threshold: Record<string, number | boolean>;
}>();

const emit = defineEmits<{
  close: [];
  save: [];
}>();

const { t } = useI18n();
</script>

<template>
  <CommonBaseModal
    :open="open && !!audit"
    labelledby="nd-audit-config-title"
    overlay-class="items-center justify-center bg-black/60"
    z-index-class="z-50"
    panel-class="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md"
    @close="emit('close')"
  >
    <template v-if="audit">
      <h3 id="nd-audit-config-title" class="text-lg font-bold text-white mb-4">{{ audit.label }}</h3>
      <p class="text-sm text-gray-400 mb-4">{{ audit.description }}</p>

      <div class="space-y-3">
        <div v-for="field in audit.thresholdSchema" :key="field.key" class="flex items-center gap-3">
          <label class="text-sm text-gray-300 flex-1">{{ field.label }}</label>
          <input
            v-if="field.type === 'number'"
            v-model.number="threshold[field.key]"
            type="number"
            :min="field.min"
            :max="field.max"
            :step="field.key.includes('Ratio') ? 0.05 : 1"
            class="w-24 rounded border border-neutral-600 bg-neutral-800 text-white px-2 py-1 text-sm"
          />
          <input
            v-else
            v-model="threshold[field.key]"
            type="checkbox"
            class="rounded border-neutral-600"
          />
        </div>
      </div>

      <div class="flex justify-end gap-2 mt-6">
        <button
          class="px-4 py-2 text-sm rounded-lg bg-neutral-700 text-white hover:bg-neutral-600"
          @click="emit('close')"
        >
          {{ t('reports.cancel') }}
        </button>
        <button
          class="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-500"
          @click="emit('save')"
        >
          {{ t('reports.admin.save') }}
        </button>
      </div>
    </template>
  </CommonBaseModal>
</template>
