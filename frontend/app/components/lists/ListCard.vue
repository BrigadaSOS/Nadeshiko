<script setup lang="ts">
import { mdiPlaylistMusic, mdiBookmarkMultiple, mdiViewGrid } from '@mdi/js';
import type { ListDTO } from '@/stores/lists';

const props = defineProps<{
  list: ListDTO;
}>();

const typeIcon = computed(() => {
  switch (props.list.type) {
    case 'SERIES': return mdiViewGrid;
    case 'SEGMENT': return mdiBookmarkMultiple;
    default: return mdiPlaylistMusic;
  }
});
</script>

<template>
  <NuxtLink
    :to="`/lists/${list.id}`"
    class="group block rounded-lg border dark:border-white/10 dark:bg-card-background p-4 transition-all hover:border-white/20"
  >
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-8 h-8 rounded-md bg-white/5 flex items-center justify-center">
        <UiBaseIcon :path="typeIcon" class="text-gray-400" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium dark:text-white truncate">{{ list.name }}</p>
        <p class="text-xs text-gray-400 mt-0.5">
          {{ $t(`lists.types.${list.type}`) }}
        </p>
      </div>
    </div>
  </NuxtLink>
</template>
