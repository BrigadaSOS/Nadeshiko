<script setup>
import { mdiRefresh } from '@mdi/js';

import { usePlayerStore } from '~/stores/player';

const props = defineProps({
  initialData: {
    type: Object,
    default: null,
  },
});

const { t } = useI18n();
const apiSearch = useApiSearch();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Main variables
const searchData = ref(props.initialData);
const isLoading = ref(false);
const endOfResults = ref(false);
const hasMoreResults = ref(true);
const showLoadMoreButton = ref(false);
const initialError = ref(false);

// Available params for search
const query = ref('');
const previousQuery = ref('');
const category = ref(0);
const cursor = ref(null);
const media = ref(null);
const sort = ref(null);
const uuid = ref(null);
const episode = ref(null);

// Category mapping
const categoryMapping = {
  all: 0,
  anime: 1,
  liveaction: 3,
  audiobook: 4,
};

// Get anime name for tab when filtering by specific media
const animeTabName = computed(() => {
  if (media.value && searchData.value?.sentences?.length > 0) {
    let name = searchData.value.sentences[0].basicInfo.nameAnimeEn;

    // Add episode if selected
    if (episode.value !== null) {
      name += `, ${t('searchpage.main.labels.episode')} ${episode.value}`;
    }

    return name;
  }
  return t('searchContainer.categoryAll');
});

////////////////////////////////

// Fetch sentences with an infinite scroll
const fetchSentences = async (_fromButton = false) => {
  try {
    if (endOfResults.value || isLoading.value) return;

    // If it's a new search (not loading more), hide the player.
    if (cursor.value === null) {
      playerStore.hidePlayer();
    }

    isLoading.value = true;
    showLoadMoreButton.value = false;

    // Build request body
    const body = {
      limit: 20,
      extra: true,
    };

    // Only add query if it exists (to avoid ES filters when no query is provided)
    if (query.value) {
      body.query = query.value;
    }

    // Add optional parameters, omit category if it is 'all'
    if (category.value !== 0) {
      body.category = [category.value];
    }

    if (media.value !== 0) {
      body.animeId = media.value;
    }

    if (episode.value !== null) {
      body.episode = [episode.value];
    }

    if (sort.value && sort.value !== 'none') {
      body.contentSort = sort.value;
    }

    if (cursor.value) {
      body.cursor = cursor.value;
    }

    if (uuid.value) {
      body.uuid = uuid.value;
    }

    // Define the behaviour of elements based on params
    if (previousQuery.value === query.value) {
      if (!cursor.value) {
        if (searchData.value?.sentences) {
          searchData.value.sentences = null;
        }
      }
    } else {
      searchData.value = null;
    }

    // Fetch data from API
    const response = await apiSearch.getSentenceV1(body);
    // await delay(5000)

    // Update search data
    if (cursor.value === null) {
      searchData.value = response;
    } else {
      searchData.value.sentences.push(...response.sentences);
    }
    cursor.value = response.cursor || null;

    if (!response.cursor) {
      endOfResults.value = true;
      hasMoreResults.value = false;
    } else {
      hasMoreResults.value = true;
    }

    previousQuery.value = query.value;
    initialError.value = false;
  } catch (error) {
    console.error('Error fetching sentences:', error);
    if (!searchData.value || !searchData.value.sentences || searchData.value.sentences.length === 0) {
      initialError.value = true;
    }
    hasMoreResults.value = false;
    showLoadMoreButton.value = true;
  } finally {
    isLoading.value = false;
  }
};

const loadMore = () => {
  fetchSentences(true);
};

// Get count of sentences for a specific category
const getCategoryCount = (category) => {
  if (category === 0) {
    return searchData.value.categoryStatistics.reduce((total, item) => total + item.count, 0);
  }
  const item = searchData.value.categoryStatistics.find((item) => item.category === category);
  return item ? item.count : 0;
};

// Filter sentences by category
const categoryFilter = (filter) => {
  router.push({
    query: {
      ...route.query,
      category: Object.keys(categoryMapping).find((key) => categoryMapping[key] === filter),
    },
  });
};

// Get season/episode data for the selected media
const getSeasonEpisodeData = () => {
  if (!media.value || !searchData.value?.statistics) return {};
  const mediaId = Number(media.value);
  if (Number.isNaN(mediaId)) return {};
  const selectedAnime = searchData.value.statistics.find((stat) => stat.animeId === mediaId);
  return selectedAnime?.seasonWithEpisodeHits || {};
};

const handleRandomLogic = () => {
  cursor.value = null;
  endOfResults.value = false;
  searchData.value.sentences = null;
  fetchSentences();
};

// Lifecycle hooks
onMounted(async () => {
  query.value = route.query.query;
  category.value = categoryMapping[route.query.category] ?? 0;
  media.value = route.query.media;
  sort.value = route.query.sort;
  uuid.value = route.query.uuid;
  episode.value = route.query.episode ? Number(route.query.episode) : null;

  if (category.value === undefined) {
    category.value = 0;
  }

  if (props.initialData) {
    cursor.value = props.initialData.cursor || null;
    if (!props.initialData.cursor) {
      endOfResults.value = true;
      hasMoreResults.value = false;
    }
    previousQuery.value = query.value;
  } else {
    await fetchSentences();
  }
});

onBeforeRouteUpdate(async (to, _from) => {
  query.value = to.query.query;
  category.value = categoryMapping[to.query.category] ?? 0;
  media.value = to.query.media;
  sort.value = to.query.sort;
  uuid.value = to.query.uuid;
  episode.value = to.query.episode ? Number(to.query.episode) : null;

  if (category.value === undefined) {
    category.value = 0;
  }

  cursor.value = null;
  endOfResults.value = false;
  await fetchSentences();
});
</script>

<template>
    <SearchSegmentSidebar :searchData="searchData" :categorySelected="category" :media="media" />
    <div v-if="initialError">
        <section class="w-full">
            <div class="py-10 px-4">
                <div class="w-full align-top items-center">
                    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                        <img class="mb-6"
                            src="/assets/no-results.gif" />
                        <h2 class="font-bold text-red-400 text-3xl">{{ $t('searchContainer.errorTitle') }}</h2>
                        <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchContainer.errorMessage1') }}</h1>
                        <p class="mt-4 text-gray-500 dark:text-gray-400">{{ $t('searchContainer.errorMessage2') }}
                        </p>

                        <UiButtonPrimaryAction class="my-4" @click="fetchSentences()">
                            <template v-if="isLoading">
                                {{ $t('searchContainer.retrying') }}
                                <div role="status">
                                    <svg aria-hidden="true"
                                        class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                                        viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path
                                            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                                            fill="currentColor" />
                                        <path
                                            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                                            fill="currentFill" />
                                    </svg>
                                    <span class="sr-only">{{ $t('accountSettings.anki.loading') }}</span>
                                </div>

                            </template>
                            <template v-else>
                                <UiBaseIcon :path="mdiRefresh" />
                                {{ $t('searchContainer.retryButton') }}
                            </template>
                        </UiButtonPrimaryAction>
                    </div>
                </div>
            </div>
        </section>
    </div>
    <div v-else class="flex-1 mx-auto">
        <!-- Tabs -->
        <div class="pb-4" v-if="searchData?.categoryStatistics?.length > 0">
            <CommonTabsContainer>
                <CommonTabsHeader>
                    <CommonTabsItem category="0" :categoryName="animeTabName" :count="getCategoryCount(0)"
                        :isActive="category === 0 || media" @click="categoryFilter(0)" />
                    <CommonTabsItem v-if="!media && searchData?.categoryStatistics?.find((item) => item.category === 1)"
                        category="1" :categoryName="t('searchContainer.categoryAnime')" :count="getCategoryCount(1)" :isActive="category === 1"
                        @click="categoryFilter(1)" />
                    <CommonTabsItem v-if="!media && searchData?.categoryStatistics?.find((item) => item.category === 3)"
                        category="3" :categoryName="t('searchContainer.categoryLiveaction')" :count="getCategoryCount(3)" :isActive="category === 3"
                        @click="categoryFilter(3)" />
                    <CommonTabsItem v-if="!media && searchData?.categoryStatistics?.find((item) => item.category === 4)"
                        category="4" :categoryName="t('searchContainer.categoryAudiobook')" :count="getCategoryCount(4)" :isActive="category === 4"
                        @click="categoryFilter(4)" />
                </CommonTabsHeader>
            </CommonTabsContainer>
        </div>
        <div v-else-if="isLoading && !searchData?.sentences?.length || !searchData" class="w-full pb-4  animate-pulse">
            <CommonTabsContainer>
                <CommonTabsHeader>
                    <div v-for="i in 3" :key="i" class="flex  flex-row space-x-10 gap-10 py-5">
                        <p class="p-2 bg-gray-200 rounded-lg mr-6 dark:bg-neutral-700 px-16"></p>
                    </div>
                </CommonTabsHeader>
            </CommonTabsContainer>
        </div>
        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer :searchData="searchData" :isLoading="isLoading" />
                <CommonInfiniteScrollObserver @intersect="fetchSentences" v-if="hasMoreResults && !isLoading" />
                <div v-if="showLoadMoreButton" class="text-center mt-4 mb-8">
                    <UiButtonPrimaryAction class="my-1" @click="loadMore">
                        <UiBaseIcon :path="mdiRefresh" />
                        {{ $t('searchContainer.loadMore') }}
                    </UiButtonPrimaryAction>
                </div>
                <div v-if="endOfResults && !hasMoreResults && searchData?.sentences?.length > 0" class="text-center mt-4 mb-8">
                    <p class="text-gray-500 dark:text-gray-400">
                        {{ $t('searchContainer.endOfResults') }}
                    </p>
                </div>
            </div>
            <!-- Filters -->
            <div class="2xl:min-w-[18rem] 2xl:max-w-[18rem]">
                <div v-if="searchData?.statistics?.length > 0" class="p-2 mx-auto hidden 2xl:block">
                    <SearchSegmentFilterSortContent @randomSortSelected="handleRandomLogic()" />
                    <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
                    <SearchSegmentFilterSeasonEpisodeFilter
                        v-if="media"
                        :seasonWithEpisodeHits="getSeasonEpisodeData()"
                        :selectedMediaId="media"
                    />
                </div>
                <div v-else-if="isLoading && !searchData?.sentences?.length || !searchData">
                    <div class="pl-4 mx-auto hidden 2xl:block min-w-[340px]">
                        <div role=" status" class="hidden w-10/12 2xl:flex flex-col py-6 animate-pulse">
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[460px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[330px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
                            <span class="sr-only">{{ $t('searchContainer.loading') }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
