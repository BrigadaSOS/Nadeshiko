<script setup lang="ts">
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { buildSentenceMetaTags } from '~/utils/metaTags';

const shortcutsModal = ref(null);

const route = useRoute();
const { mediaName } = useMediaName();
const { contentRating } = useContentRating();

const firstQueryValue = (value) => (Array.isArray(value) ? value[0] : value);
const getStringQueryValue = (value) => {
  const normalized = firstQueryValue(value);
  if (normalized === undefined || normalized === null || normalized === '') {
    return null;
  }
  return String(normalized);
};

const collectionIdParam = computed(() => {
  const raw = getStringQueryValue(route.query.collectionId);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
});

const mediaQueryParam = computed(() => getStringQueryValue(route.query.media ?? route.query.mediaId));
const episodeQueryParam = computed(() => getStringQueryValue(route.query.episode ?? route.query.episodeId));

const episodeNumberParam = computed(() => {
  if (!episodeQueryParam.value) {
    return null;
  }
  const parsed = Number(episodeQueryParam.value);
  return Number.isNaN(parsed) ? null : parsed;
});

const searchQuery = computed(() => {
  if (route.params.query) {
    return decodeURIComponent(String(route.params.query));
  }
  return String(route.query.query || '');
});

const fetchSentenceData = async () => {
  try {
    const apiSearch = useApiSearch();

    if (collectionIdParam.value) {
      return await apiSearch.searchCollectionSegments(collectionIdParam.value);
    }

    const body = {
      limit: 20,
    };
    const filters = {};

    const q = searchQuery.value;
    if (q) {
      body.query = q;
    }

    if (route.query.uuid) {
      body.uuid = route.query.uuid;
    }

    const categoryValue = CATEGORY_API_MAPPING[route.query.category];
    if (categoryValue) {
      filters.category = [categoryValue];
    }

    if (mediaQueryParam.value) {
      const mediaEntry = { mediaId: Number(mediaQueryParam.value) };
      if (episodeNumberParam.value !== null) {
        mediaEntry.episodes = [episodeNumberParam.value];
      }
      filters.media = { include: [mediaEntry] };
    }

    if (route.query.sort && route.query.sort !== 'NONE') {
      body.sort = route.query.sort;
    }

    filters.contentRating = contentRating.value;
    body.filters = filters;
    return await apiSearch.searchSegments(body);
  } catch (error) {
    console.error('Error fetching sentence data:', error);
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const apiSearch = useApiSearch();

    if (collectionIdParam.value) {
      return await apiSearch.getCollectionStats(collectionIdParam.value);
    }

    const body = {};
    const filters = {};

    const q = searchQuery.value;
    if (q) {
      body.query = q;
    }

    const categoryValue = CATEGORY_API_MAPPING[route.query.category];
    if (categoryValue) {
      filters.category = [categoryValue];
    }

    filters.contentRating = contentRating.value;
    body.filters = filters;
    return await apiSearch.getSearchStats(body);
  } catch (error) {
    console.error('Error fetching search stats:', error);
    return null;
  }
};

const sentenceCacheKey = computed(() => {
  const params = [
    searchQuery.value,
    route.query.uuid,
    route.query.category,
    mediaQueryParam.value,
    episodeQueryParam.value,
    route.query.sort,
  ]
    .filter(Boolean)
    .join('-');
  return `search-sentences-${params || 'default'}`;
});

const statsCacheKey = computed(() => {
  const params = [searchQuery.value, route.query.category, mediaQueryParam.value, episodeQueryParam.value]
    .filter(Boolean)
    .join('-');
  return `search-stats-${params || 'default'}`;
});

const { data: initialSentenceData } = await useAsyncData(sentenceCacheKey.value, () => fetchSentenceData(), {
  server: true,
  lazy: false,
});

const { data: initialStatsData } = await useAsyncData(statsCacheKey.value, () => fetchStatsData(), {
  server: true,
  lazy: false,
});

const { data: collectionDetails } = await useAsyncData(
  `collection-details-${collectionIdParam.value ?? 'none'}`,
  async () => {
    if (!collectionIdParam.value) return null;
    return await $fetch<{ name?: string }>(`/api/collections/${collectionIdParam.value}`).catch(() => null);
  },
  { server: true, lazy: false },
);

const metaTags = computed(() => {
  const defaultDescription =
    'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!';

  const tags = {
    title: 'Nadeshiko',
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: 'Nadeshiko' },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  };

  const result = initialSentenceData.value?.results?.[0];
  const q = searchQuery.value;

  if (route.query.uuid && result) {
    const sentenceTags = buildSentenceMetaTags(result, mediaName);
    tags.title = sentenceTags.title;
    tags.meta = sentenceTags.meta;
  } else if (q) {
    const stats = initialStatsData.value?.categories;
    const pagination = initialSentenceData.value?.pagination;
    const totalResults = pagination?.estimatedTotalHits || stats?.reduce((sum, s) => sum + s.count, 0) || 0;
    const isLowerBound = pagination?.estimatedTotalHitsRelation === 'LOWER_BOUND';

    const title = `Search: ${q} | Nadeshiko`;
    let description =
      totalResults > 0
        ? `${isLowerBound ? 'At least ' : ''}${totalResults.toLocaleString()} results found`
        : 'Search for Japanese sentences';

    if (stats && stats.length > 0) {
      const categoryNames = { ANIME: 'anime', JDRAMA: 'live-action' };
      const order = ['ANIME', 'JDRAMA'];
      const breakdown = order
        .map((cat) => stats.find((s) => s.category === cat))
        .filter(Boolean)
        .filter((s) => s.count > 0)
        .map((s) => `${categoryNames[s.category]}: ${s.count.toLocaleString()}`)
        .join(', ');
      if (breakdown) {
        description += ` (${breakdown})`;
      }
    }

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ];
  } else if (mediaQueryParam.value && initialSentenceData.value?.results?.length > 0) {
    const firstResult = initialSentenceData.value.results[0];
    const animeName = mediaName(firstResult.media);
    const mediaId = firstResult.media.mediaId;

    const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaId === Number(mediaId));

    const filterEpisode = episodeNumberParam.value;

    let totalResults = mediaStats?.segmentCount || 0;
    const episodeHits = mediaStats?.episodeHits;

    if (episodeHits && filterEpisode) {
      totalResults = episodeHits[filterEpisode] || 0;
    }

    const title = `${animeName} | Nadeshiko`;
    let description = `${totalResults.toLocaleString()} sentences`;

    if (episodeHits && Object.keys(episodeHits).length > 0) {
      const episodeCount = Object.keys(episodeHits).length;
      if (filterEpisode) {
        description = `${totalResults.toLocaleString()} sentences, episode ${filterEpisode}`;
      } else {
        description += ` across ${episodeCount} episode${episodeCount > 1 ? 's' : ''}`;
      }
    }

    const thumbnail = firstResult.media?.coverUrl || firstResult.urls.imageUrl;

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: thumbnail },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: thumbnail },
    ];
  }

  return tags;
});

useHead(metaTags);
</script>

<template>
    <NuxtLayout>
        <div class="mx-auto">
            <div class="relative text-white">
                <div class="pt-2">
                    <div class="md:max-w-[92%] mx-auto">
                        <SearchModalKeyboardShortcuts ref="shortcutsModal" />
                        <SearchBaseInputSegment compact />
                        <SearchContainer :initial-sentence-data="initialSentenceData" :initial-stats-data="initialStatsData" :collection-id="collectionIdParam" :collection-name="collectionDetails?.name ?? null">
                            <template #result-controls>
                                <div class="flex items-center gap-3">
                                    <SearchTranslationVisibilityPreferences />
                                    <button
                                        class="hidden lg:inline-flex rounded-md px-3 py-1 text-sm font-medium bg-neutral-800 text-neutral-500 border border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                        @click="shortcutsModal?.open()"
                                        :title="$t('shortcuts.title')"
                                    >
                                        ? {{ $t('shortcuts.title') }}
                                    </button>
                                </div>
                            </template>
                        </SearchContainer>
                    </div>
                </div>
            </div>
        </div>
    </NuxtLayout>
</template>
<style>
em {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    font-style: normal;
    color: #df848d;
}
</style>
