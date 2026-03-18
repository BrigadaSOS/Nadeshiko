<script setup lang="ts">
import { mdiRefresh, mdiEyeOff } from '@mdi/js';
import type { RouteLocationNormalized, LocationQueryValue } from 'vue-router';

import { usePlayerStore } from '~/stores/player';
import { userStore } from '~/stores/auth';
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';
import type {
  SearchResponse,
  SearchStatsResponse,
  SearchFilters,
  ResolvedMediaStats,
  ResolvedCategoryCount,
} from '~/types/search';

const { mediaName } = useMediaName();
const { hiddenMediaIds, hiddenMediaExcludeFilter, isMediaHidden } = useHiddenMedia();

const recomputeCategories = (media: ResolvedMediaStats[]): ResolvedCategoryCount[] => {
  const counts = new Map<'ANIME' | 'JDRAMA', number>();
  for (const m of media) {
    const cat = m.category === 'JDRAMA' ? 'JDRAMA' : 'ANIME';
    counts.set(cat, (counts.get(cat) ?? 0) + m.matchCount);
  }
  return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
};

const props = defineProps<{
  initialSentenceData?: SearchResponse | null;
  initialStatsData?: SearchStatsResponse | null;
  listMediaIds?: number[] | null;
  collectionId?: string | null;
  collectionName?: string | null;
}>();

const { t } = useI18n();
const sdk = useNadeshikoSdk();
const { contentRating } = useContentRating();
const { excludedLanguages } = useTranslationVisibility();
const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();

const sentenceData = ref<SearchResponse | null>(props.initialSentenceData ?? null);
const statsData = ref<SearchStatsResponse | null>(props.initialStatsData ?? null);
const isLoading = ref(false);
const endOfResults = ref(false);
const lastTrackedQuery = ref<string | null>(null);
const isSingleSentenceView = computed(() => route.path.startsWith('/sentence/'));
const hasMoreResults = ref(!route.path.startsWith('/sentence/'));
const showLoadMoreButton = ref(false);
const initialError = ref(false);

const query = ref('');
const category = ref('all');
const cursor = ref<string | null>(null);
const media = ref<string | null>(null);
const sort = ref<string | null>(null);
const uuid = ref<string | null>(null);
const episode = ref<number | null>(null);

const categoryApiMapping = CATEGORY_API_MAPPING;
const showHiddenMediaOverride = ref(false);

const isViewingHiddenMedia = computed(
  () => !!media.value && !showHiddenMediaOverride.value && isMediaHidden(media.value),
);

const showAnywayAndRefresh = () => {
  showHiddenMediaOverride.value = true;
  resetSentencePagination();
  fetchStats();
  fetchSentences();
};

const firstQueryValue = (
  value: LocationQueryValue | LocationQueryValue[] | undefined,
): LocationQueryValue | undefined => (Array.isArray(value) ? value[0] : value);
const getStringQueryValue = (value: LocationQueryValue | LocationQueryValue[] | undefined): string | null => {
  const normalized = firstQueryValue(value);
  if (normalized === undefined || normalized === null || normalized === '') {
    return null;
  }
  return String(normalized);
};

const searchData = computed(() => {
  const sentencePayload = sentenceData.value;
  const statsPayload = statsData.value;
  const hidden = new Set(hiddenMediaIds.value);

  const allMedia = statsPayload?.media || ([] as ResolvedMediaStats[]);
  const filteredMedia = hidden.size > 0 ? allMedia.filter((m) => !hidden.has(m.publicId)) : allMedia;

  const categories = hidden.size > 0
    ? recomputeCategories(filteredMedia)
    : statsPayload?.categories || ([] as ResolvedCategoryCount[]);

  return {
    results: sentencePayload?.results || [],
    cursor: sentencePayload?.pagination?.cursor,
    pagination: sentencePayload?.pagination,
    categories,
    media: filteredMedia,
  };
});

const animeTabName = computed(() => {
  if (props.collectionId) {
    return props.collectionName ?? t('searchContainer.collectionTabPrefix');
  }
  if (media.value) {
    const mediaStat = (searchData.value?.media || []).find((item) => item.publicId === media.value);
    const mediaSource = mediaStat || searchData.value?.results?.[0]?.media || null;

    if (mediaSource) {
      let name = mediaName(mediaSource);
      if (episode.value !== null) {
        name += `, ${t('searchpage.main.labels.episode')} ${episode.value}`;
      }
      return name;
    }

    return t('searchContainer.categoryAll');
  }

  const singleResult = searchData.value?.results;
  if (singleResult?.length === 1 && !query.value) {
    return mediaName(singleResult[0]!.media);
  }

  return t('searchContainer.categoryAll');
});

const isSingleSegmentView = computed(() => {
  return searchData.value?.results?.length === 1 && !query.value && !media.value && !props.collectionId;
});

const getSearchQuery = (r: RouteLocationNormalized): string => {
  if (r.params?.query) {
    return decodeURIComponent(String(r.params.query));
  }
  return typeof r.query?.query === 'string' ? r.query.query : '';
};

const applyRouteQuery = (r: RouteLocationNormalized) => {
  query.value = getSearchQuery(r);
  const queryParams = r.query || {};
  const categoryParam = getStringQueryValue(queryParams.category);
  category.value = categoryParam === 'anime' || categoryParam === 'liveaction' ? categoryParam : 'all';
  media.value = getStringQueryValue(queryParams.media ?? queryParams.mediaId);
  sort.value = getStringQueryValue(queryParams.sort);
  uuid.value = getStringQueryValue(queryParams.uuid);

  const episodeParam = getStringQueryValue(queryParams.episode ?? queryParams.episodeId);
  if (episodeParam === null) {
    episode.value = null;
  } else {
    const parsedEpisode = Number(episodeParam);
    episode.value = Number.isNaN(parsedEpisode) ? null : parsedEpisode;
  }
};

applyRouteQuery(route);

const fetchStats = async () => {
  try {
    if (props.collectionId) {
      const { data, response } = await sdk.getCollectionStats({ path: { id: props.collectionId } });
      if (response.status === 403 || response.status === 401) {
        await navigateTo('/', { redirectCode: 302 });
        return;
      }
      statsData.value = data ? resolveStatsResponse(data) : { media: [], categories: [] };
      return;
    }

    const filters: SearchFilters = {};

    const mappedCategory = categoryApiMapping[category.value];
    if (mappedCategory) {
      filters.category = [mappedCategory];
    }

    if (props.listMediaIds && props.listMediaIds.length > 0) {
      filters.media = { include: props.listMediaIds.map((id: number) => ({ mediaId: String(id) })) };
    }

    filters.contentRating = contentRating.value;
    if (hiddenMediaExcludeFilter.value.length > 0) {
      filters.media = {
        ...(filters.media || {}),
        exclude: [...(filters.media?.exclude || []), ...hiddenMediaExcludeFilter.value],
      };
    }
    if (excludedLanguages.value.length > 0) {
      filters.languages = { exclude: excludedLanguages.value };
    }

    const { data } = await sdk.getSearchStats({
      body: {
        query: query.value ? { search: query.value } : undefined,
        filters,
        include: ['media'],
      },
    });
    statsData.value = data ? resolveStatsResponse(data) : { media: [], categories: [] };
  } catch {
    statsData.value = {
      media: [],
      categories: [],
    };
  }
};

const fetchSentences = async () => {
  try {
    if (isViewingHiddenMedia.value) {
      sentenceData.value = { results: [] };
      endOfResults.value = true;
      hasMoreResults.value = false;
      return;
    }

    if (endOfResults.value || isLoading.value) {
      return;
    }

    if (cursor.value === null) {
      playerStore.hidePlayer();
    }

    isLoading.value = true;
    showLoadMoreButton.value = false;

    let response;

    if (props.collectionId) {
      const { data, response: fetchResponse } = await sdk.searchCollectionSegments({
        path: { id: props.collectionId },
        query: {
          ...(cursor.value ? { cursor: cursor.value } : {}),
          take: 20,
        },
      });
      if (fetchResponse.status === 403 || fetchResponse.status === 401) {
        await navigateTo('/', { redirectCode: 302 });
        return;
      }
      response = data ? resolveSearchResponse(data) : null;
    } else {
      const filters: SearchFilters = {};

      const mappedCategory = categoryApiMapping[category.value];
      if (mappedCategory) {
        filters.category = [mappedCategory];
      }

      // Build media include filter
      const mediaInclude: Array<{ mediaId: string; episodes?: number[] }> = [];
      if (media.value) {
        const mediaEntry: { mediaId: string; episodes?: number[] } = { mediaId: String(media.value) };
        if (episode.value !== null) {
          mediaEntry.episodes = [episode.value];
        }
        mediaInclude.push(mediaEntry);
      }
      if (props.listMediaIds && props.listMediaIds.length > 0) {
        for (const id of props.listMediaIds) {
          mediaInclude.push({ mediaId: String(id) });
        }
      }
      if (mediaInclude.length > 0) {
        filters.media = { include: mediaInclude };
      }

      filters.contentRating = contentRating.value;
      if (!media.value && hiddenMediaExcludeFilter.value.length > 0) {
        filters.media = {
          ...(filters.media || {}),
          exclude: [...(filters.media?.exclude || []), ...hiddenMediaExcludeFilter.value],
        };
      }
      if (excludedLanguages.value.length > 0) {
        filters.languages = { exclude: excludedLanguages.value };
      }

      const isInitialSearch = !cursor.value;
      const { data } = await sdk.search({
        body: {
          query: query.value ? { search: query.value } : undefined,
          take: 30,
          sort:
            sort.value && sort.value.toUpperCase() !== 'NONE'
              ? { mode: sort.value.toUpperCase() as 'ASC' | 'DESC' | 'TIME_ASC' | 'TIME_DESC' | 'RANDOM' }
              : undefined,
          cursor: cursor.value || undefined,
          filters,
          include: ['media'],
        },
      });
      response = data ? resolveSearchResponse(data) : null;

      if (isInitialSearch && query.value && query.value !== lastTrackedQuery.value && import.meta.client && userStore().isLoggedIn) {
        lastTrackedQuery.value = query.value;
        sdk.trackUserActivity({ body: { activityType: 'SEARCH', searchQuery: query.value } }).catch(() => {});
      }
    }
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

    const nextCursor = response?.pagination?.cursor || null;
    const hasMore = response?.pagination?.hasMore ?? false;
    cursor.value = nextCursor;

    if (!hasMore || !nextCursor || isSingleSentenceView.value) {
      endOfResults.value = true;
      hasMoreResults.value = false;
    } else {
      hasMoreResults.value = true;
    }

    initialError.value = false;
  } catch {
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

const getCategoryCount = (categoryKey: string): number => {
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

const categoryFilter = (categoryKey: string) => {
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

const selectedMediaStat = computed(() => {
  if (!media.value || !searchData.value?.media) return null;
  return searchData.value.media.find((stat) => stat.publicId === media.value) ?? null;
});

const isSelectedMediaMovie = computed(() => selectedMediaStat.value?.airingFormat === 'MOVIE');

const getEpisodeHitsData = () => {
  return selectedMediaStat.value?.episodeHits || {};
};

const handleRemoveFromCollection = async (segmentId: number) => {
  if (!props.collectionId) return;
  try {
    await sdk.removeSegmentFromCollection({
      path: { id: props.collectionId, segmentId },
    });
    // Remove from current results
    if (sentenceData.value?.results) {
      sentenceData.value = {
        ...sentenceData.value,
        results: sentenceData.value.results.filter((r) => r.segment.id !== segmentId),
      };
    }
    // Refresh stats
    fetchStats();
  } catch {
    // Collection removal failed — UI keeps segment visible
  }
};

const handleRandomLogic = () => {
  resetSentencePagination();
  fetchSentences();
};

if (props.initialSentenceData) {
  cursor.value = props.initialSentenceData.pagination?.cursor || null;
  const initialResults = props.initialSentenceData.results || [];
  if (
    !props.initialSentenceData.pagination?.hasMore ||
    !props.initialSentenceData.pagination?.cursor ||
    initialResults.length < 30
  ) {
    endOfResults.value = true;
    hasMoreResults.value = false;
  }
}

onMounted(async () => {
  if (props.initialSentenceData === undefined) {
    resetSentencePagination();
    await fetchSentences();
  }

  if (props.initialStatsData === undefined) {
    fetchStats();
  }
});

const forceSearchCounter = useState('force-search-counter', () => 0);

watch(forceSearchCounter, () => {
  resetSentencePagination();
  fetchStats();
  fetchSentences();
});

onBeforeRouteUpdate(async (to, from) => {
  const toQuery = getSearchQuery(to);
  const fromQuery = getSearchQuery(from);
  const statsScopeChanged = toQuery !== fromQuery || to.query.category !== from.query.category;

  applyRouteQuery(to);
  showHiddenMediaOverride.value = false;
  resetSentencePagination();

  if (statsScopeChanged) {
    fetchStats();
  }

  await fetchSentences();
});
</script>

<template>
    <SearchSegmentSidebar :searchData="searchData" :categorySelected="category" :media="media" :isMovieMedia="isSelectedMediaMovie" />
    <div v-if="isViewingHiddenMedia" class="flex-1 mx-auto">
        <section class="w-full py-10 px-4">
            <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                <img class="mb-6" src="/assets/hidden-media.gif" alt="Hidden media illustration" />
                <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchContainer.hiddenMediaNotice') }}</h1>
                <p class="mt-4 text-gray-500 dark:text-gray-400">{{ $t('searchContainer.hiddenMediaDescription') }}</p>
                <button
                    class="mt-6 px-5 py-2.5 rounded-lg text-sm font-medium border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                    @click="showAnywayAndRefresh()"
                >
                    {{ $t('searchContainer.hiddenMediaShowAnyway') }}
                </button>
            </div>
        </section>
    </div>
    <div v-else-if="initialError">
        <div class="pb-3">
            <div class="flex items-center justify-end gap-3 border-b border-[#dddddd21] pb-3">
                <div class="shrink-0">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <section class="w-full">
            <div class="py-10 px-4">
                <div class="w-full align-top items-center">
                    <div class="flex flex-col items-center max-w-lg mx-auto text-center">
                        <img class="mb-6"
                            src="/assets/no-results.gif" alt="No results illustration" />
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
        <div class="pb-3" v-if="searchData?.categories?.length > 0">
            <div class="search-tabs-row flex items-center gap-3 border-b border-[#dddddd21]">
                <NuxtLink
                    v-if="collectionId"
                    to="/user/collections"
                    class="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-white/40 hover:text-white/80 transition-colors pr-4 py-4 border-r border-white/10"
                >
                    <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M15 8C15 8.55228 14.5523 9 14 9L1.91421 9L7.20711 14.2929C7.59763 14.6834 7.59763 15.3166 7.20711 15.7071C6.81658 16.0976 6.18342 16.0976 5.79289 15.7071L-0.0303268 9.88388C-0.518518 9.39573 -0.518518 8.60427 -0.0303268 8.11612L5.79289 0.292893C6.18342 -0.097631 6.81658 -0.097631 7.20711 0.292893C7.59763 0.683417 7.59763 1.31658 7.20711 1.70711L1.91421 7L14 7C14.5523 7 15 7.44772 15 8Z"/>
                    </svg>
                    {{ $t('searchContainer.backToCollections') }}
                </NuxtLink>
                <div class="search-tabs-main min-w-0 flex-1">
                    <CommonTabsContainer>
                        <CommonTabsHeader :showBorder="false">
                            <CommonTabsItem category="all" :categoryName="animeTabName" :count="getCategoryCount('all')"
                                :isActive="category === 'all' || media" @click="categoryFilter('all')" />
                            <CommonTabsItem v-if="!media && !isSingleSegmentView && searchData?.categories?.find((item) => item.category === 'ANIME')"
                                category="anime" :categoryName="t('searchContainer.categoryAnime')" :count="getCategoryCount('anime')" :isActive="category === 'anime'"
                                @click="categoryFilter('anime')" />
                            <CommonTabsItem v-if="!media && !isSingleSegmentView && searchData?.categories?.find((item) => item.category === 'JDRAMA')"
                                category="liveaction" :categoryName="t('searchContainer.categoryLiveaction')" :count="getCategoryCount('liveaction')" :isActive="category === 'liveaction'"
                                @click="categoryFilter('liveaction')" />
                        </CommonTabsHeader>
                    </CommonTabsContainer>
                </div>
                <div class="shrink-0">
                    <SearchResultControls />
                </div>
            </div>
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
        <div v-else class="pb-3">
            <div class="flex items-center gap-3 border-b border-[#dddddd21] py-4">
                <NuxtLink
                    v-if="collectionId"
                    to="/user/collections"
                    class="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-white/40 hover:text-white/80 transition-colors pr-4 py-4 border-r border-white/10"
                >
                    <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path fill-rule="evenodd" clip-rule="evenodd" d="M15 8C15 8.55228 14.5523 9 14 9L1.91421 9L7.20711 14.2929C7.59763 14.6834 7.59763 15.3166 7.20711 15.7071C6.81658 16.0976 6.18342 16.0976 5.79289 15.7071L-0.0303268 9.88388C-0.518518 9.39573 -0.518518 8.60427 -0.0303268 8.11612L5.79289 0.292893C6.18342 -0.097631 6.81658 -0.097631 7.20711 0.292893C7.59763 0.683417 7.59763 1.31658 7.20711 1.70711L1.91421 7L14 7C14.5523 7 15 7.44772 15 8Z"/>
                    </svg>
                    {{ $t('searchContainer.backToCollections') }}
                </NuxtLink>
                <span v-if="collectionId && collectionName" class="text-white/70 font-medium text-sm truncate max-w-[20rem]">{{ collectionName }}</span>
                <div class="shrink-0 ml-auto">
                    <SearchResultControls />
                </div>
            </div>
        </div>
        <div class="flex mx-auto w-full">
            <!-- Segment -->
            <div class="flex-1 mx-auto w-full">
                <SearchSegmentContainer :searchData="searchData" :isLoading="isLoading" :collectionId="collectionId" @remove-from-collection="handleRemoveFromCollection" />
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
            <div v-if="searchData?.media?.length > 0 || isLoading" class="2xl:min-w-[18rem] 2xl:max-w-[18rem]">
                <div v-if="searchData?.media?.length > 0" class="p-2 mx-auto hidden 2xl:block">
                    <SearchSegmentFilterSortContent @randomSortSelected="handleRandomLogic()" />
                    <SearchSegmentFilterContent :searchData="searchData" :categorySelected="category" />
                    <SearchSegmentFilterEpisodeFilter
                        v-if="media && !isSelectedMediaMovie"
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

