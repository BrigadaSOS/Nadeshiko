<script setup>
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { buildSentenceMetaTags } from '~/utils/metaTags';

const shortcutsModal = ref(null);

const route = useRoute();
const { mediaName } = useMediaName();
const { contentRating } = useContentRating();

const searchQuery = computed(() => {
  if (route.params.query) {
    return decodeURIComponent(String(route.params.query));
  }
  return String(route.query.query || '');
});

const fetchSentenceData = async () => {
  try {
    const apiSearch = useApiSearch();
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

    if (route.query.media) {
      const mediaEntry = { mediaId: Number(route.query.media) };
      if (route.query.episode) {
        mediaEntry.episodes = [Number(route.query.episode)];
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
    route.query.media,
    route.query.episode,
    route.query.sort,
  ]
    .filter(Boolean)
    .join('-');
  return `search-sentences-${params || 'default'}`;
});

const statsCacheKey = computed(() => {
  const params = [searchQuery.value, route.query.category, route.query.media, route.query.episode]
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
        description += `\n(${breakdown})`;
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
  } else if (route.query.media && initialSentenceData.value?.results?.length > 0) {
    const firstResult = initialSentenceData.value.results[0];
    const animeName = mediaName(firstResult.media);
    const mediaId = firstResult.media.mediaId;

    const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaId === Number(mediaId));

    const filterEpisode = route.query.episode ? Number(route.query.episode) : null;

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
        description = `${totalResults.toLocaleString()} sentences\nEpisode ${filterEpisode}`;
      } else {
        description += `\n${episodeCount} episode${episodeCount > 1 ? 's' : ''}`;
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
                        <SearchBaseInputSegment />
                        <div class="mt-2 flex items-center justify-end gap-3">
                            <SearchTranslationVisibilityPreferences />
                            <button
                                class="rounded-md px-3 py-1 text-sm font-medium bg-neutral-800 text-neutral-500 border border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                @click="shortcutsModal?.open()"
                                :title="$t('shortcuts.title')"
                            >
                                ? {{ $t('shortcuts.title') }}
                            </button>
                        </div>
                        <SearchContainer :initial-sentence-data="initialSentenceData" :initial-stats-data="initialStatsData" />
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
