<script setup lang="ts">
import type { SegmentRevision } from '@brigadasos/nadeshiko-sdk';

defineProps<{
  revisions: SegmentRevision[];
  isLoading: boolean;
  activeSnapshotNumber: number | null;
}>();

const emit = defineEmits<{
  'restore-current': [];
  'select-revision': [revision: SegmentRevision];
}>();

const { t } = useI18n();
const { formatRelativeTime } = useFormat();
</script>

<template>
  <div class="w-80 flex-shrink-0 overflow-y-auto max-h-[70vh] p-4 space-y-2">
    <h4 class="text-sm font-semibold text-neutral-300 mb-3">{{ t('modalSegmentEdit.history') }}</h4>

    <div v-if="isLoading" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</div>

    <div v-else-if="revisions.length === 0" class="text-xs text-neutral-500">
      {{ t('modalSegmentEdit.noRevisions') }}
    </div>

    <template v-else>
      <!-- Current button -->
      <button
        type="button"
        class="w-full text-left rounded-lg border p-2.5 text-sm transition-colors"
        :class="activeSnapshotNumber === null
          ? 'border-blue-500 bg-blue-900/20 text-blue-300'
          : 'border-hairline bg-control text-ink-muted hover:border-line-hover'"
        @click="emit('restore-current')"
      >
        <span class="font-medium">{{ t('modalSegmentEdit.current') }}</span>
      </button>

      <!-- Revision cards -->
      <button
        v-for="rev in revisions"
        :key="rev.id"
        type="button"
        class="w-full text-left rounded-lg border p-2.5 text-sm transition-colors"
        :class="activeSnapshotNumber === rev.revisionNumber
          ? 'border-blue-500 bg-blue-900/20 text-blue-300'
          : 'border-hairline bg-control text-ink-muted hover:border-line-hover'"
        @click="emit('select-revision', rev)"
      >
        <div class="font-medium">{{ t('modalSegmentEdit.snapshot') }} {{ rev.revisionNumber }}</div>
        <div class="text-xs mt-0.5 text-neutral-500">
          {{ formatRelativeTime(rev.createdAt) }}
          <span v-if="rev.userName"> · {{ rev.userName }}</span>
        </div>
      </button>
    </template>
  </div>
</template>
