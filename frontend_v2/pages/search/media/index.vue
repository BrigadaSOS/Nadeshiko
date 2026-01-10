<script setup>
import { useRouter, useRoute } from "vue-router";
import { mdiGrid, mdiFormatListBulletedSquare, mdiArrowRight } from "@mdi/js";

const apiSearch = useApiSearch();
const media = ref([]);
const router = useRouter();
const route = useRoute();

// Filter variables
const query = ref("");
const searchQuery = ref("");
const filterType = ref("");

// Pagination variables
const currentView = ref("grid");
const page = ref(1);
const pageSize = ref(28);
const hasMore = ref(false);

// States and misc variables
const loading = ref(false);
let debounceTimeout = null;

// Fetch media function
const fetchMedia = async () => {
  loading.value = true;

  try {
    const response = await apiSearch.getRecentMedia({
      cursor: (page.value - 1) * pageSize.value,
      query: searchQuery.value,
      size: pageSize.value,
      type: filterType.value,
    });
    media.value = response.results || [];
    hasMore.value = response.hasMoreResults && response.results.length > 0;
  } catch (error) {
    console.error("Error fetching media:", error);
  } finally {
    loading.value = false;
    scrollToTop();
  }
};

// View change functions
const setGridView = () => {
  currentView.value = "grid";
};

const setListView = () => {
  currentView.value = "list";
};

const nextPage = () => {
  page.value++;
};

const beforePage = () => {
  page.value--;
};

const scrollToTop = () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
};

// Filter handling
const handleFilterChange = (type) => {
  page.value = 1;
  filterType.value = type;
  updateUrl();
  fetchMedia();
};

const updateUrl = () => {
  const params = {
    page: page.value,
    view: currentView.value,
    query: searchQuery.value || undefined,
    type: filterType.value || undefined,
  };
  router.push({ query: params });
};

// Lifecycle
onMounted(() => {
  loading.value = true;
  page.value = parseInt(route.query.page) || 1;
  currentView.value = route.query.view === "list" ? "list" : "grid";
  query.value = route.query.query || "";
  searchQuery.value = query.value;
  filterType.value = route.query.type || "";
  fetchMedia();
});

watch(query, () => {
  if (debounceTimeout) clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    page.value = 1;
    searchQuery.value = query.value.trim();
    filterType.value = type;
  }, 300);
});

watch([page, currentView, searchQuery], () => {
  updateUrl();
  fetchMedia();
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
        <SearchDropdownContainer class="" dropdownId="hs-dropdown-with-header">
          <template #default>
            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
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
              :alt="media_info.english_name"
              class="w-full h-full object-cover transition-transform duration-300 ease-in-out"
            />
          </div>
          <p
            class="mt-2 text-sm font-medium text-gray-200 text-left line-clamp-2 px-2 w-full"
          >
            {{ media_info?.english_name }}
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

            <div class="relative flex-auto p-6 z-10">
              <div class="flex flex-wrap">
                <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                  {{ media_info.english_name }}
                </h1>
                <div
                  class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white"
                >
                  {{ $t('searchContainer.categoryAnime') }}
                </div>
                <div
                  class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300"
                >
                  {{ media_info.japanese_name }} - {{ media_info.romaji_name }}
                </div>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="grid grid-cols-2">
                <p
                  class="text-sm font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.sentenceCountLabel') }} {{ media_info.num_segments }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.wordCountLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.uniqueWordsLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.uniqueKanjiLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.uniqueWordsOnceLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.lexicalDiversityLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.anilistScoreLabel') }}
                </p>
                <p
                  class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300"
                >
                  {{ $t('animeList.difficultyLabel') }}
                </p>
              </div>

              <div
                class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
              ></div>

              <div class="flex mt-2 items-center flex-wrap">
                <div
                  class="flex h-8 flex-row grow-0 border mr-2 shadow-sm rounded-xl dark:bg-modal-input dark:border-sgray2"
                >
                  <div class="px-2 py-2 text-center">
                    <div class="flex items-center gap-x-2">
                      <p class="text-xs uppercase tracking-wide text-white">
                        {{ $t('animeList.seasons') }}:
                      </p>
                      <p
                        class="text-xs font-medium text-gray-800 dark:text-gray-200"
                      >
                        {{ media_info.num_seasons }}
                      </p>
                    </div>
                  </div>
                </div>

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
                        {{ media_info.num_episodes }}
                      </p>
                    </div>
                  </div>
                </div>

                <div class="ml-auto mt-4 md:mt-1 flex">
                  <button
                    type="button"
                    data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
                    class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-white dark:placeholder-gray-400 dark:text-white"
                  >
                    <div>{{ $t('animeList.anilistButton') }}</div>
                  </button>

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
