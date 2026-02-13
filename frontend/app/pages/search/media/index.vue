<script setup>
import { mdiGrid, mdiFormatListBulletedSquare, mdiArrowRight } from '@mdi/js';

const apiSearch = useApiSearch();
const router = useRouter();
const route = useRoute();

const allowedFilterTypes = new Set(['anime', 'liveaction', 'audiobook']);
const pageSize = 28;
let debounceTimeout = null;

const normalizePage = (value) => {
  const parsed = Number.parseInt(String(value || '1'), 10);
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed;
};

const normalizeView = (value) => (value === 'list' ? 'list' : 'grid');
const normalizeQuery = (value) => (typeof value === 'string' ? value : '');
const normalizeType = (value) => {
  const type = typeof value === 'string' ? value : '';
  return allowedFilterTypes.has(type) ? type : '';
};

const page = computed(() => normalizePage(route.query.page));
const currentView = computed(() => normalizeView(route.query.view));
const searchQuery = computed(() => normalizeQuery(route.query.query));
const filterType = computed(() => normalizeType(route.query.type));

const buildQueryParams = (params = {}) => {
  const nextPage = normalizePage(params.page ?? page.value);
  const nextView = normalizeView(params.view ?? currentView.value);
  const nextQuery = normalizeQuery(params.query ?? searchQuery.value);
  const nextType = normalizeType(params.type ?? filterType.value);

  return {
    page: String(nextPage),
    view: nextView,
    query: nextQuery || undefined,
    type: nextType || undefined,
  };
};

const isSameQuery = (nextQuery) => {
  const current = buildQueryParams();
  return (
    current.page === nextQuery.page &&
    current.view === nextQuery.view &&
    (current.query || '') === (nextQuery.query || '') &&
    (current.type || '') === (nextQuery.type || '')
  );
};

const updateUrl = async (params = {}) => {
  const nextQuery = buildQueryParams(params);

  if (isSameQuery(nextQuery)) {
    return;
  }

  await router.push({ query: nextQuery });
};

const {
  data: mediaResponse,
  pending,
  error,
} = await useAsyncData(
  () => `search-media-${page.value}-${searchQuery.value}-${filterType.value}`,
  () =>
    apiSearch.getRecentMedia({
      cursor: (page.value - 1) * pageSize,
      query: searchQuery.value,
      size: pageSize,
      type: filterType.value,
    }),
  {
    watch: [page, searchQuery, filterType],
    server: true,
    lazy: false,
    default: () => ({
      results: [],
      hasMoreResults: false,
    }),
  },
);

const media = computed(() => mediaResponse.value?.results || []);
const hasMore = computed(() => Boolean(mediaResponse.value?.hasMoreResults && media.value.length > 0));
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
    updateUrl({
      page: 1,
      query: value.trim(),
    });
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

const nextPage = () => {
  updateUrl({ page: page.value + 1 });
};

const beforePage = () => {
  updateUrl({ page: page.value - 1 });
};

const scrollToTop = () => {
  if (!import.meta.client) {
    return;
  }

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
};

const handleFilterChange = (type) => {
  updateUrl({
    page: 1,
    type,
  });
};

watch([page, currentView, searchQuery, filterType], () => {
  scrollToTop();
});
</script>

<template>
  <NuxtLayout>
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
                :selected="filterType === ''"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAnime')"
                @click="handleFilterChange('anime')"
                :selected="filterType === 'anime'"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryLiveaction')"
                @click="handleFilterChange('liveaction')"
                :selected="filterType === 'liveaction'"
              />
              <SearchDropdownItem
                :text="$t('searchContainer.categoryAudiobook')"
                @click="handleFilterChange('audiobook')"
                :selected="filterType === 'audiobook'"
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
        <!-- Loading Placeholder for Grid -->
        <div v-if="loading" v-for="i in pageSize" :key="i" class="flex flex-col items-center animate-pulse">
          <div class="relative w-full overflow-hidden rounded-lg bg-[rgba(255,255,255,0.06)] aspect-[2/3]"></div>
          <div class="mt-2 w-full h-4  rounded"></div>
        </div>

        <!-- Media Content -->
        <NuxtLink
          v-else
          v-for="(media_info, index) in media"
          :key="media_info.id"
          :to="`/search/sentence?media=${media_info.id}`"
          class="flex flex-col items-center"
        >
          <div
            class="relative w-full overflow-hidden rounded-lg shadow-lg transition-all bg-[rgba(255,255,255,0.06)] aspect-[2/3]"
          >
            <img
              :src="media_info.cover"
              :alt="media_info.englishName"
              class="w-full h-full object-cover transition-transform duration-300 ease-in-out"
            />
          </div>
          <p
            class="mt-2 text-sm font-medium text-gray-200 text-left line-clamp-2 px-2 w-full"
          >
            {{ media_info?.englishName }}
          </p>
        </NuxtLink>
      </div>
      <div v-if="currentView === 'list'" class="tab-content">
        <!-- Loading Placeholder for List -->
        <div v-if="loading" v-for="i in pageSize" :key="i" class="w-full relative mb-4 animate-pulse">
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
          v-if="media.length > 0"
          v-for="(media_info, index) in media"
          :key="media_info.id"
          class="w-full relative mb-4"
        >
          <div
            class="relative flex flex-col z-20 items-center sm:items-start sm:flex-row rounded-lg dark:bg-card-background transition-all dark:border-white/10 border"
          >
            <div class="absolute inset-0">
              <img
                :src="media_info.banner"
                class="object-cover w-full h-full rounded-lg"
              />
              <div
                class="absolute inset-0 bg-card-background opacity-95 rounded-lg"
              ></div>
            </div>
            <div class="relative flex-none w-[16em] h-[21em]">
              <img
                :src="media_info.cover"
                class="absolute inset-0 object-cover w-full h-full rounded-lg"
              />
            </div>

            <div class="relative flex-auto p-6 z-10 flex flex-col">
              <div class="flex flex-wrap">
                <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                  {{ media_info.englishName }}
                </h1>
                <div
                  class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white"
                >
                  {{ $t('searchContainer.categoryAnime') }}
                </div>
                <div
                  class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300"
                >
                  {{ media_info.japaneseName }} - {{ media_info.romajiName }}
                </div>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="grid grid-cols-1">
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.sentenceCountLabel') }} {{ media_info.numSegments }}
                </p>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="flex mt-auto items-center flex-wrap">
                <div
                  class="flex h-8 flex-row border shadow-sm rounded-xl dark:bg-modal-input dark:border-sgray2"
                >
                  <div class="px-2 py-2 text-center">
                    <div class="flex items-center gap-x-2">
                      <p class="text-xs uppercase tracking-wide text-white">
                        {{ $t('animeList.episodes') }}:
                      </p>
                      <p
                        class="text-xs font-medium text-gray-800 dark:text-gray-200"
                      >
                        {{ media_info.numEpisodes }}
                      </p>
                    </div>
                  </div>
                </div>

                <div class="ml-auto mt-4 md:mt-1 flex">
                  <a
                    :href="`https://anilist.co/anime/${media_info.anilistId}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-white dark:placeholder-gray-400 dark:text-white"
                  >
                    <div>{{ $t('animeList.anilistButton') }}</div>
                  </a>

                  <NuxtLink
                    :to="`/search/sentence?media=${media_info.id}`"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-green-500/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-green-400 dark:placeholder-gray-400 dark:text-green-400"
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
      <div v-if="media.length > 0" class="flex flex-1 py-6">
        <button
          v-if="page > 1"
          @click="beforePage()"
          class="border-b-2 border-red-500 p-2 left-0 px-4 py-2 text-white transition-transform transform"
        >
          {{ $t('animeList.previousPage') }}
        </button>

        <button
          v-if="hasMore"
          @click="nextPage()"
          class="ml-auto border-b-2 border-red-500 p-2 right-0 px-4 py-2 text-white transition-transform transform"
        >
          {{ $t('animeList.nextPage') }}
        </button>
      </div>
    </div>
  </NuxtLayout>
</template>
