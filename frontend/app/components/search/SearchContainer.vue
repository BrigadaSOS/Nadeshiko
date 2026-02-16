<script setup>
import { mdiRefresh } from '@mdi/js';

import { usePlayerStore } from '~/stores/player';
import { CATEGORY_API_MAPPING } from '~/utils/categories';

const { mediaName } = useMediaName();

const props = defineProps({
  initialSentenceData: {
    type: Object,
    default: null,
  },
  initialStatsData: {
    type: Object,
    default: null,
  },
  listMediaIds: {
    type: Array,
    default: null,
  },
});

const { t } = useI18n();
const apiSearch = useApiSearch();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();

const sentenceData = ref(props.initialSentenceData);
const statsData = ref(props.initialStatsData);
const isLoading = ref(false);
const endOfResults = ref(false);
const hasMoreResults = ref(true);
const showLoadMoreButton = ref(false);
const initialError = ref(false);

const query = ref('');
const category = ref('all');
const cursor = ref(null);
const media = ref(null);
const sort = ref(null);
const uuid = ref(null);
const episode = ref(null);

const categoryApiMapping = CATEGORY_API_MAPPING;

const searchData = computed(() => {
  const sentencePayload = sentenceData.value || {};
  const statsPayload = statsData.value || {};

  return {
    results: sentencePayload.results || [],
    cursor: sentencePayload.cursor,
    pagination: sentencePayload.pagination,
    categories: statsPayload.categories || [],
    media: statsPayload.media || [],
  };
});

const animeTabName = computed(() => {
  if (media.value && searchData.value?.results?.length > 0) {
    let name = mediaName(searchData.value.results[0].media);
    if (episode.value !== null) {
      name += `, ${t('searchpage.main.labels.episode')} ${episode.value}`;
    }

    return name;
  }
  return t('searchContainer.categoryAll');
});

const getSearchQuery = (r) => {
  if (r.params?.query) {
    return decodeURIComponent(String(r.params.query));
  }
  return typeof r.query?.query === 'string' ? r.query.query : '';
};

const applyRouteQuery = (r) => {
  query.value = getSearchQuery(r);
  const queryParams = r.query || {};
  category.value =
    queryParams.category === 'anime' || queryParams.category === 'liveaction' ? queryParams.category : 'all';
  media.value = queryParams.media || null;
  sort.value = queryParams.sort || null;
  uuid.value = queryParams.uuid || null;
  episode.value = queryParams.episode ? Number(queryParams.episode) : null;
};

applyRouteQuery(route);

const fetchStats = async () => {
  try {
    const body = {};

    if (query.value) {
      body.query = query.value;
    }

    const mappedCategory = categoryApiMapping[category.value];
    if (mappedCategory) {
      body.category = [mappedCategory];
    }

    if (props.listMediaIds && props.listMediaIds.length > 0) {
      body.mediaIds = props.listMediaIds;
    }

    statsData.value = await apiSearch.getSearchStats(body);
  } catch (error) {
    console.error('Error fetching search stats:', error);
    statsData.value = {
      media: [],
      categories: [],
    };
  }
};

const fetchSentences = async () => {
  try {
    if (endOfResults.value || isLoading.value) {
      return;
    }

    if (cursor.value === null) {
      playerStore.hidePlayer();
    }

    isLoading.value = true;
    showLoadMoreButton.value = false;

    const body = {
      limit: 20,
    };

    if (query.value) {
      body.query = query.value;
    }

    const mappedCategory = categoryApiMapping[category.value];
    if (mappedCategory) {
      body.category = [mappedCategory];
    }

    if (media.value) {
      body.mediaId = Number(media.value);
    }

    if (episode.value !== null) {
      body.episode = [episode.value];
    }

    if (sort.value && sort.value !== 'NONE') {
      body.contentSort = sort.value;
    }

    if (cursor.value) {
      body.cursor = cursor.value;
    }

    if (uuid.value) {
      body.uuid = uuid.value;
    }

    if (props.listMediaIds && props.listMediaIds.length > 0) {
      body.media = props.listMediaIds.map((id) => ({ mediaId: id, episodes: [] }));
    }

    const response = await apiSearch.searchSegments(body);
    const incomingResults = response?.results || [];

    if (cursor.value === null) {
      sentenceData.value = {
        ...response,
        results: incomingResults,
      };
    } else {
      const previousResults = sentenceData.value?.results || [];
      sentenceData.value = {
        ...sentenceData.value,
        ...response,
        results: [...previousResults, ...incomingResults],
      };
    }

    cursor.value = response?.cursor || null;

    if (!response?.cursor) {
      endOfResults.value = true;
      hasMoreResults.value = false;
    } else {
      hasMoreResults.value = true;
    }

    initialError.value = false;
  } catch (error) {
    console.error('Error fetching sentences:', error);
    if (!sentenceData.value?.results || sentenceData.value.results.length === 0) {
      initialError.value = true;
    }
    hasMoreResults.value = false;
    showLoadMoreButton.value = true;
  } finally {
    isLoading.value = false;
  }
};

const resetSentencePagination = () => {
  cursor.value = null;
  endOfResults.value = false;
  hasMoreResults.value = true;
  sentenceData.value = {
    ...sentenceData.value,
    results: [],
  };
};

const loadMore = () => {
  fetchSentences();
};

const getCategoryCount = (categoryKey) => {
  if (media.value) {
    return searchData.value?.pagination?.estimatedTotalHits || 0;
  }

  const stats = searchData.value?.categories || [];

  if (categoryKey === 'all') {
    return stats.reduce((total, item) => total + item.count, 0);
  }

  const mappedCategory = categoryApiMapping[categoryKey];
  const item = stats.find((entry) => entry.category === mappedCategory);
  return item ? item.count : 0;
};

const categoryFilter = (categoryKey) => {
  const queryParams = {
    ...route.query,
  };

  if (categoryKey === 'all') {
    delete queryParams.category;
  } else {
    queryParams.category = categoryKey;
  }

  router.push({ path: route.path, query: queryParams });
};

const getEpisodeHitsData = () => {
  if (!media.value || !searchData.value?.media) {
    return {};
  }

  const mediaId = Number(media.value);
  if (Number.isNaN(mediaId)) {
    return {};
  }

  const selectedMedia = searchData.value.media.find((stat) => stat.mediaId === mediaId);
  return selectedMedia?.episodeHits || {};
};

const handleRandomLogic = () => {
  resetSentencePagination();
  fetchSentences();
};

if (props.initialSentenceData) {
  cursor.value = props.initialSentenceData.cursor || null;
  if (!props.initialSentenceData.cursor) {
    endOfResults.value = true;
    hasMoreResults.value = false;
  }
}

onMounted(async () => {
  if (!props.initialSentenceData) {
    resetSentencePagination();
    await fetchSentences();
  }

  if (!props.initialStatsData) {
    fetchStats();
  }
});

onBeforeRouteUpdate(async (to, from) => {
  const toQuery = getSearchQuery(to);
  const fromQuery = getSearchQuery(from);
  const statsScopeChanged = toQuery !== fromQuery || to.query.category !== from.query.category;

  applyRouteQuery(to);
  resetSentencePagination();

  if (statsScopeChanged) {
    fetchStats();
  }

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
        <div class="pb-4" v-if="searchData?.categories?.length > 0">
            <CommonTabsContainer>
                <CommonTabsHeader>
                    <CommonTabsItem category="all" :categoryName="animeTabName" :count="getCategoryCount('all')"
                        :isActive="category === 'all' || media" @click="categoryFilter('all')" />
                    <CommonTabsItem v-if="!media && searchData?.categories?.find((item) => item.category === 'ANIME')"
                        category="anime" :categoryName="t('searchContainer.categoryAnime')" :count="getCategoryCount('anime')" :isActive="category === 'anime'"
                        @click="categoryFilter('anime')" />
                    <CommonTabsItem v-if="!media && searchData?.categories?.find((item) => item.category === 'JDRAMA')"
                        category="liveaction" :categoryName="t('searchContainer.categoryLiveaction')" :count="getCategoryCount('liveaction')" :isActive="category === 'liveaction'"
                        @click="categoryFilter('liveaction')" />
                </CommonTabsHeader>
            </CommonTabsContainer>
        </div>
        <div v-else-if="isLoading && !searchData?.results?.length || !searchData" class="w-full pb-4  animate-pulse">
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
                <div v-if="endOfResults && !hasMoreResults && searchData?.results?.length > 0" class="text-center mt-4 mb-8">
                    <p class="text-gray-500 dark:text-gray-400">
                        {{ $t('searchContainer.endOfResults') }}
                    </p>
                </div>
            </div>
            <!-- Filters -->
            <div class="2xl:min-w-[18rem] 2xl:max-w-[18rem]">
                <div v-if="searchData?.media?.length > 0" class="p-2 mx-auto hidden 2xl:block">
                    <SearchSegmentFilterSortContent @randomSortSelected="handleRandomLogic()" />
                    <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
                    <SearchSegmentFilterEpisodeFilter
                        v-if="media"
                        :episodeHits="getEpisodeHitsData()"
                        :selectedMediaId="media"
                    />
                </div>
                <div v-else-if="isLoading && !searchData?.results?.length || !searchData">
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
