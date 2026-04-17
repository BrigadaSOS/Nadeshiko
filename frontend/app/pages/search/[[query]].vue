<script setup lang="ts">
import type { SearchFilters } from '~/types/search';
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { buildSentenceMetaTags, socialTitle } from '~/utils/metaTags';
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';

const route = useRoute();

const { mediaName } = useMediaName();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const { hiddenMediaExcludeFilter } = useHiddenMedia();

const firstQueryValue = (value: string | string[] | undefined | null) => (Array.isArray(value) ? value[0] : value);
const getStringQueryValue = (value: string | string[] | undefined | null) => {
  const normalized = firstQueryValue(value);
  if (normalized === undefined || normalized === null || normalized === '') {
    return null;
  }
  return String(normalized);
};

const mediaQueryParam = computed(() =>
  getStringQueryValue((route.query.media ?? route.query.mediaId) as string | string[] | undefined),
);
const episodeQueryParam = computed(() =>
  getStringQueryValue((route.query.episode ?? route.query.episodeId) as string | string[] | undefined),
);

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

const searchFetchFailed = ref(false);

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();

    const filters: SearchFilters = {};
    const q = searchQuery.value;

    if (route.query.uuid) {
      const segmentPublicId = String(route.query.uuid);
      const segment = await sdk.getSegment(segmentPublicId);
      if (!segment) return null;
      const media = await sdk.getMedia(segment.mediaPublicId);
      return resolveSearchResponse({
        segments: [segment],
        includes: { media: media ? { [segment.mediaPublicId]: media } : {} },
        pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
      });
    }

    const categoryValue = CATEGORY_API_MAPPING[route.query.category as string];
    if (categoryValue) {
      filters.category = [categoryValue];
    }

    if (mediaQueryParam.value) {
      const mediaEntry: { mediaPublicId: string; episodes?: number[] } = {
        mediaPublicId: mediaQueryParam.value,
      };
      if (episodeNumberParam.value !== null) {
        mediaEntry.episodes = [episodeNumberParam.value];
      }
      filters.media = { include: [mediaEntry] };
    }

    filters.contentRating = contentRating.value;
    if (includedLanguages.value) {
      filters.languages = includedLanguages.value;
    }
    if (!mediaQueryParam.value && hiddenMediaExcludeFilter.value.length > 0) {
      filters.media = { ...(filters.media || {}), exclude: hiddenMediaExcludeFilter.value };
    }

    const sortParam = route.query.sort ? String(route.query.sort).toUpperCase() : null;
    const sort =
      sortParam && sortParam !== 'RELEVANCE'
        ? { mode: sortParam as 'ASC' | 'DESC' | 'TIME_ASC' | 'TIME_DESC' | 'RANDOM' }
        : undefined;

    const result = await sdk.search({
      query: q ? { search: q } : undefined,
      take: 30,
      sort,
      filters,
      include: ['media'],
      throwOnError: false,
    });

    if ('error' in result) {
      if (result.response.status >= 500) {
        searchFetchFailed.value = true;
      }
      return null;
    }

    return resolveSearchResponse(result.data);
  } catch {
    searchFetchFailed.value = true;
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const sdk = useNadeshikoSdk();

    const filters: SearchFilters = {};
    const q = searchQuery.value;

    const categoryValue = CATEGORY_API_MAPPING[route.query.category as string];
    if (categoryValue) {
      filters.category = [categoryValue];
    }

    filters.contentRating = contentRating.value;
    if (includedLanguages.value) {
      filters.languages = includedLanguages.value;
    }
    if (hiddenMediaExcludeFilter.value.length > 0) {
      filters.media = { ...(filters.media || {}), exclude: hiddenMediaExcludeFilter.value };
    }

    const data = await sdk.getSearchStats({
      query: q ? { search: q } : undefined,
      filters,
      include: ['media'],
    });
    return resolveStatsResponse(data);
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

const [{ data: initialSentenceData }, { data: initialStatsData }] = await Promise.all([
  useAsyncData(sentenceCacheKey.value, () => fetchSentenceData(), {
    server: true,
    lazy: false,
    watch: [],
  }),
  useAsyncData(statsCacheKey.value, () => fetchStatsData(), {
    server: true,
    lazy: false,
    watch: [],
  }),
]);

const requestOrigin = useRequestURL().origin;

const metaTags = computed(() => {
  const defaultDescription =
    'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.';

  const tags: { title: string; meta: Array<{ name?: string; property?: string; content: string }> } = {
    title: 'Search',
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: socialTitle('Search') },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: socialTitle('Search') },
      { name: 'twitter:description', content: defaultDescription },
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
    const totalResults = pagination?.estimatedTotalHits || stats?.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0;
    const isLowerBound = pagination?.estimatedTotalHitsRelation === 'AT_LEAST';

    const title = q;
    let description: string;

    if (totalResults > 0) {
      const count = `${isLowerBound ? 'At least ' : ''}${totalResults.toLocaleString()}`;
      let breakdown = '';
      if (stats && stats.length > 0) {
        const categoryNames: Record<string, string> = { ANIME: 'anime', JDRAMA: 'live-action' };
        const order = ['ANIME', 'JDRAMA'];
        const parts = order
          .map((cat) => stats.find((s) => s.category === cat))
          .filter((s): s is NonNullable<typeof s> => s != null)
          .filter((s) => (s.count ?? 0) > 0)
          .map((s) => `${(s.count ?? 0).toLocaleString()} from ${categoryNames[s.category]}`);
        if (parts.length > 0) {
          breakdown = ` (${parts.join(', ')})`;
        }
      }
      description = `${count} example sentences containing "${q}"${breakdown} with English and Spanish translations.`;
    } else {
      description = `Search for "${q}" in over 1 million Japanese sentences from anime and J-dramas, with English and Spanish translations.`;
    }

    const social = socialTitle(title);
    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ];
  } else if (mediaQueryParam.value && (initialSentenceData.value?.results?.length ?? 0) > 0) {
    const firstResult = initialSentenceData.value?.results[0];
    const animeName = firstResult ? mediaName(firstResult.media) : '';
    const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === mediaQueryParam.value);

    const filterEpisode = episodeNumberParam.value;

    let totalResults = mediaStats?.matchCount || 0;
    const episodeHits = mediaStats?.episodeHits;

    if (episodeHits && filterEpisode) {
      totalResults = episodeHits.find((h) => h.episode === filterEpisode)?.hitCount ?? 0;
    }

    const title = animeName;
    let description = `${totalResults.toLocaleString()} Japanese sentences from ${animeName} with English and Spanish translations`;

    if (episodeHits && episodeHits.length > 0) {
      const episodeCount = episodeHits.length;
      if (filterEpisode) {
        description = `${totalResults.toLocaleString()} Japanese sentences from ${animeName} episode ${filterEpisode} with English and Spanish translations`;
      } else {
        description += ` across ${episodeCount} episode${episodeCount > 1 ? 's' : ''}`;
      }
    }

    const coverUrl = firstResult?.media?.coverUrl;
    const ogImage = coverUrl || `${requestOrigin}/logo-og-5bc76788.png`;

    const social = socialTitle(title);
    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: ogImage },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: ogImage },
    ];
  }

  return tags;
});

useHead(metaTags);

const schemaOrgType = computed<'CollectionPage' | 'SearchResultsPage'>(() =>
  mediaQueryParam.value ? 'CollectionPage' : 'SearchResultsPage',
);
useSchemaOrg([defineWebPage({ '@type': schemaOrgType.value })]);
</script>

<template>
    <div class="mx-auto">
            <div class="relative text-white">
                <div class="pt-2">
                    <div class="md:max-w-[90%] mx-auto">
                        <h1 v-if="searchQuery" class="sr-only">{{ metaTags.title }}</h1>
                        <div class="px-4 md:px-0">
                            <SearchBaseInputSegment />
                        </div>
                        <SearchContainer :initial-sentence-data="initialSentenceData" :initial-stats-data="initialStatsData" />
                    </div>
                </div>
            </div>
        </div>
</template>
<style>
em {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    font-style: normal;
    color: #df848d;
}

.highlight-tail {
    text-decoration: underline dotted;
    text-underline-offset: 0.2em;
    color: #df848d;
    opacity: 0.7;
}
</style>
