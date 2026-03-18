<script setup>
import { mdiGrid, mdiFormatListBulletedSquare, mdiArrowRight, mdiPencilOutline, mdiEyeOff } from '@mdi/js';
import { userStore } from '@/stores/auth';

useSeoMeta({
  title: 'Browse Media | Nadeshiko',
  ogTitle: 'Browse Media | Nadeshiko',
  description:
    'Browse anime, J-dramas, and audiobooks available on Nadeshiko. Search through thousands of media titles with Japanese sentences.',
  ogDescription:
    'Browse anime, J-dramas, and audiobooks available on Nadeshiko. Search through thousands of media titles with Japanese sentences.',
});

defineOgImage({
  title: 'Browse Media | Nadeshiko',
  description: 'Browse anime, J-dramas, and audiobooks available on Nadeshiko.',
});

useSchemaOrg([
  defineWebPage({ '@type': 'CollectionPage' }),
]);

const sdk = useNadeshikoSdk();
const router = useRouter();
const route = useRoute();
const { mediaName, language } = useMediaName();
const { hiddenMediaIds } = useHiddenMedia();
const user = userStore();

const mediaToEdit = ref(null);

const EDIT_OVERLAY_ID = '#nd-vertically-centered-scrollable-media-edit';

const openEditModal = (mediaInfo) => {
  mediaToEdit.value = mediaInfo;
  nextTick(() => {
    window.NDOverlay?.open(EDIT_OVERLAY_ID);
  });
};

const onEditSuccess = (updatedMedia) => {
  const index = media.value.findIndex((m) => m.id === updatedMedia.id);
  if (index !== -1) {
    media.value[index] = { ...media.value[index], ...updatedMedia };
  }
};

const onDeleteSuccess = (mediaId) => {
  media.value = media.value.filter((m) => m.id !== mediaId);
};

const secondaryMediaNames = (mediaInfo) => {
  const namesByLanguage = {
    english: mediaInfo?.nameEn || '',
    japanese: mediaInfo?.nameJa || '',
    romaji: mediaInfo?.nameRomaji || '',
  };

  const order = ['english', 'japanese', 'romaji'];
  const secondary = order
    .filter((lang) => lang !== language.value)
    .map((lang) => namesByLanguage[lang])
    .filter(Boolean);

  return secondary.join(' - ');
};

const allowedFilterTypes = new Set(['ANIME', 'JDRAMA']);
const pageSize = 28;
let debounceTimeout = null;

const normalizeView = (value) => (value === 'list' ? 'list' : 'grid');
const normalizeQuery = (value) => (typeof value === 'string' ? value : '');
const normalizeCategory = (value) => {
  const category = typeof value === 'string' ? value : '';
  return allowedFilterTypes.has(category) ? category : '';
};

const currentView = computed(() => normalizeView(route.query.view));
const searchQuery = computed(() => normalizeQuery(route.query.query));
const filterCategory = computed(() => normalizeCategory(route.query.category));

const buildQueryParams = (params = {}) => {
  const nextView = normalizeView(params.view ?? currentView.value);
  const nextQuery = normalizeQuery(params.query ?? searchQuery.value);
  const nextCategory = normalizeCategory(params.category ?? filterCategory.value);

  return {
    view: nextView,
    query: nextQuery || undefined,
    category: nextCategory || undefined,
  };
};

const updateUrl = async (params = {}) => {
  const nextQuery = buildQueryParams(params);
  await router.push({ query: nextQuery });
};

const media = ref([]);
const hasMore = ref(false);
const nextCursor = ref(undefined);
const loadingMore = ref(false);
const sentinelRef = ref(null);

const {
  data: initialResponse,
  pending,
  error,
} = await useAsyncData(
  () => `search-media-${searchQuery.value}-${filterCategory.value}`,
  async () => {
    const response = await sdk.listMedia({
      query: {
        query: searchQuery.value || undefined,
        take: pageSize,
        category: filterCategory.value || undefined,
      },
    });
    const raw = response.data;
    return {
      media: raw?.media ?? [],
      hasMore: raw?.pagination?.hasMore ?? false,
      cursor: raw?.pagination?.cursor ?? undefined,
    };
  },
  {
    watch: [searchQuery, filterCategory],
    server: true,
    lazy: false,
    default: () => ({
      media: [],
      hasMore: false,
      cursor: undefined,
    }),
  },
);

const syncFromResponse = () => {
  media.value = initialResponse.value?.media ?? [];
  hasMore.value = initialResponse.value?.hasMore ?? false;
  nextCursor.value = initialResponse.value?.cursor ?? undefined;
};

syncFromResponse();

watch(initialResponse, () => {
  syncFromResponse();
});

const showHidden = ref(false);

const filteredMedia = computed(() => {
  if (showHidden.value) return media.value;
  const hidden = new Set(hiddenMediaIds.value);
  if (hidden.size === 0) return media.value;
  return media.value.filter((m) => !hidden.has(m.id));
});

const hasHiddenMedia = computed(() => hiddenMediaIds.value.length > 0);

const loading = computed(() => pending.value);
const query = ref(searchQuery.value);

watch(searchQuery, (value) => {
  if (value !== query.value) {
    query.value = value;
  }
});

watch(query, (value) => {
  if (value === searchQuery.value) {
    return;
  }

  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

  debounceTimeout = setTimeout(() => {
    updateUrl({ query: value.trim() });
  }, 300);
});

watch(error, (fetchError) => {
  if (fetchError) {
    console.error('Error fetching media:', fetchError);
  }
});

onBeforeUnmount(() => {
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }
});

const setGridView = () => {
  updateUrl({ view: 'grid' });
};

const setListView = () => {
  updateUrl({ view: 'list' });
};

const loadMore = async () => {
  if (loadingMore.value || !hasMore.value || !nextCursor.value) return;

  loadingMore.value = true;
  try {
    const response = await sdk.listMedia({
      query: {
        cursor: nextCursor.value,
        query: searchQuery.value || undefined,
        take: pageSize,
        category: filterCategory.value || undefined,
      },
    });
    const raw = response.data;
    const newMedia = raw?.media ?? [];
    media.value = [...media.value, ...newMedia];
    hasMore.value = raw?.pagination?.hasMore ?? false;
    nextCursor.value = raw?.pagination?.cursor ?? undefined;
  } catch (err) {
    console.error('Error loading more media:', err);
  } finally {
    loadingMore.value = false;
  }
};

const handleFilterChange = (category) => {
  updateUrl({ category });
};

let observer = null;

const setupObserver = () => {
  if (!import.meta.client) return;

  observer?.disconnect();

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value && !loading.value) {
        loadMore();
      }
    },
    { rootMargin: '200px' },
  );

  if (sentinelRef.value) {
    observer.observe(sentinelRef.value);
  }
};

watch(sentinelRef, () => {
  setupObserver();
});

onMounted(() => {
  setupObserver();
});

onBeforeUnmount(() => {
  observer?.disconnect();
});

watch([searchQuery, filterCategory], () => {
  if (import.meta.client) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
</script>

<template>
  <div class="min-h-screen max-w-[92%] mx-auto lg:max-w-[80%]  py-6">
      <div class="inline-flex justify-between items-center w-full mb-6">
        <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
          {{ $t('animeList.fullListTitle') }}
        </h1>
      </div>
      <input
        v-model="query"
        class="block p-2.5 mb-4 w-full text-sm text-gray-900 rounded-lg border border-gray-300 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 dark:text-white"
        :placeholder="$t('searchpage.main.labels.searchmain')"
      />
      <div class="flex items-center mb-4">
        <SearchDropdownContainer class="" dropdownId="nd-dropdown-with-header">
          <template #default>
            <SearchDropdownMainButton dropdownId="nd-dropdown-with-header">
              {{ $t('searchpage.main.labels.searchbar').replace('...', '') }}
            </SearchDropdownMainButton>
          </template>
          <template #content>
            <SearchDropdownContent>
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAll')"
                @click="handleFilterChange('')"
                :selected="filterCategory === ''"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAnime')"
                @click="handleFilterChange('ANIME')"
                :selected="filterCategory === 'ANIME'"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryLiveaction')"
                @click="handleFilterChange('JDRAMA')"
                :selected="filterCategory === 'JDRAMA'"
              />
              <div v-if="hasHiddenMedia" class="my-1 border-t border-white/10"></div>
              <SearchDropdownItem
                v-if="hasHiddenMedia"
                :text="showHidden ? $t('mediaBrowse.hideHiddenMedia') : $t('mediaBrowse.showHiddenMedia')"
                :iconPath="mdiEyeOff"
                @click="showHidden = !showHidden"
                :selected="showHidden"
              />
            </SearchDropdownContent>
          </template>
        </SearchDropdownContainer>
        <div class="ml-auto gap-2 flex">
          <UiButtonPrimaryAction @click="setGridView">
            <UiBaseIcon :path="mdiGrid" />
          </UiButtonPrimaryAction>
          <UiButtonPrimaryAction @click="setListView">
            <UiBaseIcon :path="mdiFormatListBulletedSquare" />
          </UiButtonPrimaryAction>
        </div>
      </div>
      <div
        v-if="currentView === 'grid'"
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3 md:gap-4 lg:gap-5 xl:gap-6"
      >
        <!-- Loading Placeholder for Grid (initial load) -->
        <div v-if="loading && filteredMedia.length === 0" v-for="i in pageSize" :key="i" class="flex flex-col items-center animate-pulse">
          <div class="relative w-full overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)] aspect-[2/3]"></div>
          <div class="mt-2 w-full h-4  rounded"></div>
        </div>

        <!-- Media Content -->
        <div
          v-if="!loading || filteredMedia.length > 0"
          v-for="(mediaInfo, index) in filteredMedia"
          :key="mediaInfo.id"
          class="flex flex-col items-center"
        >
          <div
            class="relative w-full overflow-hidden rounded-lg shadow-lg transition-all bg-[rgba(255,255,255,0.06)] aspect-[2/3]"
          >
            <NuxtLink :to="`/search?media=${mediaInfo.publicId}`">
              <img
                :src="mediaInfo.coverUrl"
                :alt="mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'Media cover image'"
                class="w-full h-full object-cover transition-transform duration-300 ease-in-out"
              />
            </NuxtLink>
            <button
              v-if="user.isAdmin"
              class="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded bg-neutral-900/70 text-white hover:bg-neutral-900/90 transition-colors"
              @click.stop="openEditModal(mediaInfo)"
            >
              <UiBaseIcon :path="mdiPencilOutline" w="w-4" h="h-4" size="16" />
            </button>
          </div>
          <NuxtLink :to="`/search?media=${mediaInfo.publicId}`" class="mt-2 text-center justify-center flex flex-col items-center">
            <h3 class="text-sm text-center font-semibold line-clamp-2 dark:text-gray-100">
              {{ mediaName(mediaInfo) }}
            </h3>
          </NuxtLink>
          <div class="text-center mt-1 mb-5 justify-center flex flex-col items-center">
            <h3 class="text-sm text-center font-medium dark:text-gray-300">
              {{ mediaInfo.segmentCount }} {{ $t('animeList.sentenceCount') }}
            </h3>
            <h3 class="text-sm text-center font-medium dark:text-gray-300">
              <template v-if="mediaInfo.airingFormat === 'MOVIE'">{{ $t('searchpage.main.labels.movie') }}</template>
              <template v-else>{{ mediaInfo.episodeCount || 0 }} {{ $t('animeList.episodes') }}</template>
            </h3>
          </div>
        </div>
      </div>
      <div v-if="currentView === 'list'" class="tab-content">
        <!-- Loading Placeholder for List (initial load) -->
        <div v-if="loading && filteredMedia.length === 0" v-for="i in pageSize" :key="i" class="w-full relative mb-4 animate-pulse">
          <div
            class="relative flex flex-col z-20 items-center sm:items-start sm:flex-row rounded-lg bg-[rgba(255,255,255,0.06)] transition-all"
          >
            <div class="relative flex-none w-[16em] h-[21em] bg-[rgba(255,255,255,0.06)] rounded-lg"></div>

            <div class="relative flex-auto p-6 z-10">
              <div class="h-6 bg-[rgba(255,255,255,0.06)] rounded mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-3/4 mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-1/2 mb-2"></div>
              <div class="h-4 bg-[rgba(255,255,255,0.06)] rounded w-1/4"></div>
            </div>
          </div>
        </div>
        <!-- Media Content -->
        <div
          v-if="filteredMedia.length > 0"
          v-for="(mediaInfo, index) in filteredMedia"
          :key="mediaInfo.id"
          class="w-full relative mb-4"
        >
          <div
            class="relative flex flex-col z-20 items-center sm:items-stretch sm:flex-row rounded-lg dark:bg-card-background transition-all dark:border-white/10 border"
          >
            <div class="absolute inset-0">
              <img
                :src="mediaInfo.bannerUrl"
                :alt="`Banner image for ${mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'media'}`"
                class="object-cover w-full h-full rounded-lg"
              />
              <div
                class="absolute inset-0 bg-card-background opacity-95 rounded-lg"
              ></div>
            </div>
            <div class="relative flex-none w-[16em] h-[21em]">
              <img
                :src="mediaInfo.coverUrl"
                :alt="`Cover image for ${mediaName(mediaInfo) || mediaInfo.nameEn || mediaInfo.nameRomaji || mediaInfo.nameJa || 'media'}`"
                class="absolute inset-0 object-cover w-full h-full rounded-lg"
              />
            </div>

            <div class="relative flex-auto p-6 z-10 flex flex-col sm:self-stretch">
              <div class="flex flex-wrap">
                <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                  {{ mediaName(mediaInfo) }}
                </h1>
                <div
                  class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white"
                >
                  {{ $t('searchContainer.categoryAnime') }}
                </div>
                <div
                  class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300"
                >
                  {{ secondaryMediaNames(mediaInfo) }}
                </div>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="grid grid-cols-1 gap-1">
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.sentenceCountLabel') }} {{ mediaInfo.segmentCount }}
                </p>
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  <template v-if="mediaInfo.airingFormat === 'MOVIE'">{{ $t('searchpage.main.labels.movie') }}</template>
                  <template v-else>{{ $t('animeList.episodes') }}: {{ mediaInfo.episodeCount || 0 }}</template>
                </p>
              </div>

              <div class="mt-auto pt-3 flex justify-end items-center flex-wrap gap-3">
                <div class="flex">
                  <button
                    v-if="user.isAdmin"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg dark:border-amber-400/70 dark:text-amber-400"
                    @click.stop="openEditModal(mediaInfo)"
                  >
                    <UiBaseIcon :path="mdiPencilOutline" w="w-5" h="h-5" size="20" />
                    <div>{{ $t('modalMediaEdit.editButton') }}</div>
                  </button>

                  <a
                    v-if="mediaInfo.externalIds?.anilist"
                    :href="`https://anilist.co/anime/${mediaInfo.externalIds.anilist}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-white dark:placeholder-gray-400 dark:text-white"
                  >
                    <div>{{ $t('animeList.anilistButton') }}</div>
                  </a>

                  <NuxtLink
                    :to="`/search?media=${mediaInfo.publicId}`"
                    class="py-3.5 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm hover:bg-red-500/10 text-red-600 border-red-500/70 rounded-lg focus:border-red-500 dark:border-red-400 dark:placeholder-gray-400 dark:text-red-400"
                  >
                    <div>{{ $t('animeList.vocabularyButton') }}</div>
                    <UiBaseIcon
                      :path="mdiArrowRight"
                      w="w-5 md:w-5"
                      h="h-5 md:h-5"
                      size="20"
                      class=""
                    />
                  </NuxtLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading more indicator -->
      <div v-if="loadingMore" class="flex justify-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
      </div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinelRef" v-if="hasMore && !loading" class="h-1"></div>

      <MediaModalMediaEdit
        v-if="user.isAdmin"
        :media="mediaToEdit"
        @update:success="onEditSuccess"
        @delete:success="onDeleteSuccess"
      />
    </div>
</template>
