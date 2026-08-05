<script setup lang="ts">
import type { SearchResult } from '~/types/search';

const props = defineProps<{
  segment: SearchResult;
  isLoadingInternal: boolean;
  internalHashedId: string | null;
  internalStorage: string | null;
  internalStorageBasePath: string | null;
}>();

const { t } = useI18n();

const copyUuid = async () => {
  await navigator.clipboard.writeText(props.segment.segment.publicId);
};

const copyPublicId = async () => {
  await navigator.clipboard.writeText(props.segment.segment.publicId);
};
</script>

<template>
  <div class="rounded-lg bg-neutral-800/50 border border-neutral-700 p-3 space-y-2 text-sm">
    <!-- Media name + cover thumbnail -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.media') }}</span>
      <img
        v-if="segment.media.coverUrl"
        :src="segment.media.coverUrl"
        class="w-10 h-10 rounded object-cover flex-shrink-0 text-transparent"
        :alt="segment.media.nameRomaji"
        @error="($event.target as HTMLImageElement).classList.remove('text-transparent')"
      />
      <span class="font-medium text-white truncate">{{ segment.media.nameRomaji }}</span>
      <span class="text-neutral-500">—</span>
      <span class="text-neutral-400">{{ t('modalSegmentEdit.metadata.episode') }} {{ segment.segment.episode }}</span>
    </div>
    <!-- Time -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.time') }}</span>
      <span class="font-mono text-neutral-300">{{ formatMs(segment.segment.startTimeMs) }} → {{ formatMs(segment.segment.endTimeMs) }}</span>
    </div>
    <!-- Duration -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.duration') }}</span>
      <span class="font-mono text-neutral-300">{{ ((segment.segment.endTimeMs - segment.segment.startTimeMs) / 1000).toFixed(2) }}s</span>
    </div>
    <!-- ID + position -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.id') }}</span>
      <span class="font-mono text-neutral-300">#{{ segment.segment.publicId }} · {{ t('modalSegmentEdit.metadata.position') }} {{ segment.segment.position }}</span>
    </div>
    <!-- UUID -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.uuid') }}</span>
      <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ segment.segment.publicId }}</code>
      <button
        type="button"
        class="text-neutral-500 hover:text-neutral-300 transition-colors"
        :title="t('modalSegmentEdit.metadata.copyUuid')"
        @click="copyUuid"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </button>
    </div>
    <!-- Public ID -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.publicId') }}</span>
      <code class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ segment.segment.publicId }}</code>
      <button
        type="button"
        class="text-neutral-500 hover:text-neutral-300 transition-colors"
        :title="t('modalSegmentEdit.metadata.copyPublicId')"
        @click="copyPublicId"
      >
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </button>
    </div>
    <!-- Media ID -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.mediaId') }}</span>
      <span class="font-mono text-neutral-300">{{ segment.segment.mediaPublicId }}</span>
    </div>
    <!-- Hashed ID (from internal fetch) -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.hashedId') }}</span>
      <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
      <code v-else-if="internalHashedId" class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ internalHashedId }}</code>
      <span v-else class="text-xs text-neutral-500">—</span>
    </div>
    <!-- Storage -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.storage') }}</span>
      <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
      <span v-else-if="internalStorage" class="font-mono text-neutral-300">{{ internalStorage }}</span>
      <span v-else class="text-xs text-neutral-500">—</span>
    </div>
    <!-- Storage Path -->
    <div class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.storagePath') }}</span>
      <span v-if="isLoadingInternal" class="text-xs text-neutral-500">{{ t('modalSegmentEdit.loading') }}</span>
      <code v-else-if="internalStorageBasePath" class="text-xs text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded font-mono truncate max-w-[20rem]">{{ internalStorageBasePath }}</code>
      <span v-else class="text-xs text-neutral-500">—</span>
    </div>
    <!-- Resource URLs -->
    <div v-if="segment.segment.urls.imageUrl" class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.image') }}</span>
      <a :href="segment.segment.urls.imageUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.imageUrl }}</a>
    </div>
    <div v-if="segment.segment.urls.audioUrl" class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.audio') }}</span>
      <a :href="segment.segment.urls.audioUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.audioUrl }}</a>
    </div>
    <div v-if="segment.segment.urls.videoUrl" class="flex items-center gap-2 text-neutral-300">
      <span class="text-neutral-500 min-w-[4.5rem]">{{ t('modalSegmentEdit.metadata.video') }}</span>
      <a :href="segment.segment.urls.videoUrl" target="_blank" rel="noopener noreferrer" class="text-xs text-neutral-400 hover:text-neutral-200 truncate max-w-[24rem] transition-colors">{{ segment.segment.urls.videoUrl }}</a>
    </div>
  </div>
</template>
