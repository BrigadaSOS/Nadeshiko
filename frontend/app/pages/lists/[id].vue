<script setup>
import { mdiArrowLeft, mdiPencilOutline, mdiDeleteOutline } from '@mdi/js';
import { useListsStore } from '@/stores/lists';
import { userStore } from '@/stores/auth';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const listsStore = useListsStore();
const user = userStore();

const listId = computed(() => Number(route.params.id));

const { data: list, pending, error } = await useAsyncData(
  `list-${listId.value}`,
  () => listsStore.fetchList(listId.value),
  { server: true, lazy: false },
);

const isSegmentList = computed(() => list.value?.type === 'SEGMENT');
const isOwner = computed(() => user.isLoggedIn && list.value?.userId === user.userId);

// For SEGMENT lists, fetch segments
const segmentData = ref(null);
const segmentPage = ref(1);
const loadingSegments = ref(false);

const fetchSegments = async () => {
  if (!isSegmentList.value) return;
  loadingSegments.value = true;
  try {
    segmentData.value = await listsStore.fetchListSegments(listId.value, segmentPage.value);
  } finally {
    loadingSegments.value = false;
  }
};

onMounted(() => {
  if (isSegmentList.value) {
    fetchSegments();
  }
});

// For SERIES/CUSTOM lists, get mediaIds for scoped search
const listMediaIds = computed(() => {
  if (!list.value?.media || isSegmentList.value) return [];
  return list.value.media.map((m) => m.media.id);
});

useSeoMeta({
  title: computed(() => `${list.value?.name || 'List'} | Nadeshiko`),
});

const handleDelete = async () => {
  if (!confirm(t('lists.confirmDelete'))) return;
  await listsStore.deleteList(listId.value);
  router.push('/lists');
};
</script>

<template>
  <NuxtLayout>
    <div class="min-h-screen max-w-[92%] mx-auto lg:max-w-[80%] py-6">
      <!-- Back link -->
      <NuxtLink to="/lists" class="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4">
        <UiBaseIcon :path="mdiArrowLeft" />
        {{ $t('lists.backToLists') }}
      </NuxtLink>

      <div v-if="pending" class="flex justify-center py-16">
        <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-400"></div>
      </div>

      <div v-else-if="error" class="text-center py-16">
        <p class="text-red-400">{{ $t('lists.loadError') }}</p>
      </div>

      <div v-else-if="list">
        <!-- Header -->
        <div class="flex justify-between items-start mb-6">
          <div>
            <h1 class="text-2xl font-bold dark:text-white">{{ list.name }}</h1>
            <p class="text-sm text-gray-400 mt-1">
              {{ $t(`lists.types.${list.type}`) }}
              &middot;
              {{ $t(`lists.visibility.${list.visibility}`) }}
              <template v-if="!isSegmentList && list.media">
                &middot; {{ list.media.length }} {{ $t('lists.mediaCount') }}
              </template>
              <template v-if="isSegmentList && segmentData">
                &middot; {{ segmentData.totalCount }} {{ $t('lists.segmentCount') }}
              </template>
            </p>
          </div>
          <div v-if="isOwner" class="flex gap-2">
            <UiButtonPrimaryAction @click="handleDelete" class="text-sm text-red-400">
              <UiBaseIcon :path="mdiDeleteOutline" />
            </UiButtonPrimaryAction>
          </div>
        </div>

        <!-- SERIES/CUSTOM: Media grid + scoped search -->
        <div v-if="!isSegmentList">
          <!-- Media covers -->
          <div v-if="list.media && list.media.length > 0" class="mb-6">
            <div class="flex gap-3 overflow-x-auto pb-2">
              <NuxtLink
                v-for="item in list.media"
                :key="item.media.id"
                :to="`/search?media=${item.media.id}`"
                class="flex-shrink-0 w-24"
              >
                <img
                  :src="item.media.coverUrl"
                  :alt="item.media.nameEn"
                  class="w-full aspect-[2/3] object-cover rounded-lg"
                />
                <p class="text-xs text-gray-300 mt-1 line-clamp-1">{{ item.media.nameEn || item.media.nameRomaji }}</p>
              </NuxtLink>
            </div>
          </div>

          <!-- Scoped search -->
          <SearchContainer
            v-if="listMediaIds.length > 0"
            :listMediaIds="listMediaIds"
          />
        </div>

        <!-- SEGMENT: Saved segments -->
        <div v-else>
          <div v-if="loadingSegments" class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-400"></div>
          </div>

          <div v-else-if="segmentData && segmentData.segments.length > 0">
            <SearchSegmentContainer
              :searchData="{ results: segmentData.segments.map(s => s.result), categories: [], media: [] }"
              :isLoading="false"
            />

            <!-- Pagination -->
            <div v-if="segmentData.totalCount > 20" class="flex justify-center gap-4 mt-6">
              <UiButtonPrimaryAction
                v-if="segmentPage > 1"
                @click="segmentPage--; fetchSegments()"
                class="text-sm"
              >
                {{ $t('animeList.previousPage') }}
              </UiButtonPrimaryAction>
              <UiButtonPrimaryAction
                v-if="segmentPage * 20 < segmentData.totalCount"
                @click="segmentPage++; fetchSegments()"
                class="text-sm"
              >
                {{ $t('animeList.nextPage') }}
              </UiButtonPrimaryAction>
            </div>
          </div>

          <div v-else class="text-center py-16">
            <p class="text-gray-400">{{ $t('lists.noSegments') }}</p>
          </div>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>
