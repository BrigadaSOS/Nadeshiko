<script setup>
import { mdiPlus, mdiBookmarkMultiple, mdiPlaylistMusic, mdiViewGrid } from '@mdi/js';
import { useListsStore } from '@/stores/lists';
import { userStore } from '@/stores/auth';

const { t } = useI18n();
const listsStore = useListsStore();
const user = userStore();

useSeoMeta({
  title: `${t('lists.pageTitle')} | Nadeshiko`,
  description: t('lists.pageDescription'),
});

const showCreateModal = ref(false);

const { data: publicLists, pending: loadingPublic } = await useAsyncData(
  'public-lists',
  () => listsStore.fetchPublicLists(),
  { server: true, lazy: false, default: () => [] },
);

const userLists = ref([]);
const loadingUser = ref(false);

const fetchUserLists = async () => {
  if (!user.isLoggedIn) return;
  loadingUser.value = true;
  try {
    userLists.value = await listsStore.fetchUserLists();
  } finally {
    loadingUser.value = false;
  }
};

onMounted(() => {
  fetchUserLists();
});

const seriesLists = computed(() =>
  (publicLists.value || []).filter((l) => l.type === 'SERIES'),
);

const customLists = computed(() =>
  userLists.value.filter((l) => l.type === 'CUSTOM'),
);

const segmentLists = computed(() =>
  userLists.value.filter((l) => l.type === 'SEGMENT'),
);

const onListCreated = () => {
  showCreateModal.value = false;
  fetchUserLists();
};
</script>

<template>
  <NuxtLayout>
    <div class="min-h-screen max-w-[92%] mx-auto lg:max-w-[80%] py-6">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold md:text-3xl dark:text-white">
          {{ $t('lists.pageTitle') }}
        </h1>
        <UiButtonPrimaryAction
          v-if="user.isLoggedIn"
          @click="showCreateModal = true"
          class="text-sm"
        >
          <UiBaseIcon :path="mdiPlus" />
          {{ $t('lists.createList') }}
        </UiButtonPrimaryAction>
      </div>

      <!-- Series Lists -->
      <section v-if="seriesLists.length > 0" class="mb-8">
        <h2 class="text-lg font-semibold dark:text-gray-200 mb-4 flex items-center gap-2">
          <UiBaseIcon :path="mdiViewGrid" />
          {{ $t('lists.seriesSection') }}
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <ListsListCard
            v-for="list in seriesLists"
            :key="list.id"
            :list="list"
          />
        </div>
      </section>

      <!-- User Custom Lists -->
      <section v-if="user.isLoggedIn && customLists.length > 0" class="mb-8">
        <h2 class="text-lg font-semibold dark:text-gray-200 mb-4 flex items-center gap-2">
          <UiBaseIcon :path="mdiPlaylistMusic" />
          {{ $t('lists.customSection') }}
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <ListsListCard
            v-for="list in customLists"
            :key="list.id"
            :list="list"
          />
        </div>
      </section>

      <!-- User Segment Lists -->
      <section v-if="user.isLoggedIn && segmentLists.length > 0" class="mb-8">
        <h2 class="text-lg font-semibold dark:text-gray-200 mb-4 flex items-center gap-2">
          <UiBaseIcon :path="mdiBookmarkMultiple" />
          {{ $t('lists.segmentSection') }}
        </h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <ListsListCard
            v-for="list in segmentLists"
            :key="list.id"
            :list="list"
          />
        </div>
      </section>

      <!-- Empty state -->
      <div
        v-if="!loadingPublic && !loadingUser && seriesLists.length === 0 && customLists.length === 0 && segmentLists.length === 0"
        class="text-center py-16"
      >
        <p class="text-gray-400">{{ $t('lists.noLists') }}</p>
      </div>

      <!-- Loading state -->
      <div v-if="loadingPublic || loadingUser" class="flex justify-center py-16">
        <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-400"></div>
      </div>

      <!-- Create List Modal -->
      <ListsListCreateModal
        v-if="showCreateModal"
        @close="showCreateModal = false"
        @created="onListCreated"
      />
    </div>
  </NuxtLayout>
</template>
