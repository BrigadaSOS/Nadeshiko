<script setup lang="ts">
import { mdiBookmarkPlusOutline, mdiCheck } from '@mdi/js';
import { useListsStore } from '@/stores/lists';
import type { ListDTO } from '@/stores/lists';

const props = defineProps<{
  segmentUuid: string;
}>();

const { t } = useI18n();
const listsStore = useListsStore();

const segmentLists = ref<ListDTO[]>([]);
const savedInLists = ref<Set<number>>(new Set());
const loading = ref(false);

const fetchLists = async () => {
  loading.value = true;
  try {
    const lists = await listsStore.fetchUserLists();
    segmentLists.value = lists.filter((l) => l.type === 'SEGMENT');
  } finally {
    loading.value = false;
  }
};

const toggleSave = async (listId: number) => {
  if (savedInLists.value.has(listId)) {
    await listsStore.removeSegmentFromList(listId, props.segmentUuid);
    savedInLists.value.delete(listId);
  } else {
    await listsStore.addSegmentToList(listId, props.segmentUuid);
    savedInLists.value.add(listId);
  }
};

onMounted(() => {
  fetchLists();
});
</script>

<template>
  <SearchDropdownContainer class="mr-2 my-1 text-xs" dropdownId="nd-dropdown-save-list">
    <template #default>
      <SearchDropdownMainButton dropdownId="nd-dropdown-save-list">
        <UiBaseIcon :path="mdiBookmarkPlusOutline" />
        {{ $t('lists.save') }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <template v-if="loading">
          <div class="px-4 py-2 text-sm text-gray-400">{{ $t('lists.loading') }}</div>
        </template>
        <template v-else-if="segmentLists.length === 0">
          <div class="px-4 py-2 text-sm text-gray-400">{{ $t('lists.noSegmentLists') }}</div>
        </template>
        <template v-else>
          <SearchDropdownItem
            v-for="list in segmentLists"
            :key="list.id"
            :text="list.name"
            :iconPath="savedInLists.has(list.id) ? mdiCheck : mdiBookmarkPlusOutline"
            @click="toggleSave(list.id)"
          />
        </template>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>
</template>
