<script setup lang="ts">
import type { SearchScope } from '~/composables/useSearchFetch';
import { buildSentenceMetaTags, socialTitle } from '~/utils/metaTags';
import { reportError } from '~/utils/reportError';
import { splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
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

const { fetchSentences, fetchStats } = useSearchFetch();

const searchScope = computed<SearchScope>(() => ({
  query: searchQuery.value,
  category: getStringQueryValue(route.query.category as string | string[] | undefined) ?? 'all',
  mediaPublicId: mediaQueryParam.value,
  episode: episodeNumberParam.value,
  sort: getStringQueryValue(route.query.sort as string | string[] | undefined),
  segmentPublicId: getStringQueryValue(route.query.uuid as string | string[] | undefined),
  collectionId: null,
  listMediaIds: null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  hiddenMediaExclude: hiddenMediaExcludeFilter.value,
}));

const fetchSentenceData = async () => {
  const outcome = await fetchSentences(searchScope.value);
  return outcome.status === 'ok' ? outcome.data : null;
};

const fetchStatsData = async () => {
  const outcome = await fetchStats(searchScope.value);
  if (outcome.status === 'ok') {
    return outcome.data;
  }
  if (outcome.status !== 'stale') {
    reportError('search:stats-fetch-failed', new Error(`search stats fetch returned "${outcome.status}"`), {
      'search.outcome': outcome.status,
    });
  }
  return null;
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
const isJapaneseSearchRoute = computed(() => splitLocalePrefix(route.path).localePrefix === '/ja');

const metaTags = computed(() => {
  const defaultTitle = t('seo.search.title');
  const defaultDescription = t('seo.search.defaultDescription');

  const tags: { title: string; meta: Array<{ name?: string; property?: string; content: string }> } = {
    title: defaultTitle,
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: socialTitle(defaultTitle) },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: socialTitle(defaultTitle) },
      { name: 'twitter:description', content: defaultDescription },
    ],
  };

  if (isJapaneseSearchRoute.value) {
    tags.meta.push({ name: 'robots', content: 'noindex, follow' });
  }

  const result = initialSentenceData.value?.results?.[0];
  const q = searchQuery.value;

  if (route.query.uuid && result) {
    const sentenceTags = buildSentenceMetaTags(result, mediaName, (n) => t('seo.sentence.episode', { n }));
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
      const countNum = totalResults.toLocaleString();
      const count = isLowerBound ? `${t('seo.search.atLeast')}${countNum}` : countNum;
      let breakdown = '';
      if (stats && stats.length > 0) {
        const order = ['ANIME', 'JDRAMA'];
        const parts = order
          .map((cat) => stats.find((s) => s.category === cat))
          .filter((s): s is NonNullable<typeof s> => s != null)
          .filter((s) => (s.count ?? 0) > 0)
          .map((s) =>
            t('seo.search.fromCategory', {
              count: (s.count ?? 0).toLocaleString(),
              category: t(`seo.search.category${s.category === 'ANIME' ? 'Anime' : 'Jdrama'}`),
            }),
          );
        if (parts.length > 0) {
          breakdown = t('seo.search.breakdownWrapper', { parts: parts.join(', ') });
        }
      }
      description = t('seo.search.descriptionWithResults', { count, query: q, breakdown });
    } else {
      description = t('seo.search.descriptionNoResults', { query: q });
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
    const count = totalResults.toLocaleString();
    let description = t('seo.search.mediaDescription', { count, media: animeName });

    if (episodeHits && episodeHits.length > 0) {
      const episodeCount = episodeHits.length;
      if (filterEpisode) {
        description = t('seo.search.mediaDescriptionEpisode', { count, media: animeName, episode: filterEpisode });
      } else {
        description = t('seo.search.mediaDescriptionEpisodes', { count, media: animeName, episodeCount });
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
