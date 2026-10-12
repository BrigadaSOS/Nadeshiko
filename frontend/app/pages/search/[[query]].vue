<script setup lang="ts">
import { stripEpisodeHits, stripUnreadTokenFields, type SearchScope } from '~/composables/useSearchFetch';
import {
  buildDefaultMetaTags,
  buildMediaMetaTags,
  buildSentenceMetaTags,
  pageTitle,
  socialTitle,
} from '~/utils/metaTags';
import type { Media } from '@brigadasos/nadeshiko-sdk';
import { reportError } from '~/utils/reportError';
import { buildMediaPath, decodeSearchQuery, readSearchRouteFilters } from '~/utils/routes';

definePageMeta({
  // Leaving a title scope changes the route, not the list's scroll position.
  scrollToTop(_to, from) {
    return !/\/media\/[^/]+\/?$/.test(from.path);
  },
});

const { t } = useI18n();
const { formatNumber } = useFormat();
const route = useRoute();
const localePath = useLocalePath();

const { mediaName } = useMediaName();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const { hiddenMediaExcludeFilter } = useHiddenMedia();
const { hiddenCategories } = useHiddenCategories();
const { defaultCategorySlug } = useDefaultSearchCategory();

const routeFilters = computed(() => readSearchRouteFilters(route.query));
const mediaQueryParam = computed(() => routeFilters.value.mediaPublicId);
// Cache keys retain the raw spelling, even when it parses to the same number.
const episodeQueryParam = computed(() => getStringQueryValue(route.query.episode ?? route.query.episodeId));
const episodeNumberParam = computed(() => routeFilters.value.episode);

const searchQuery = computed(() => {
  if (route.params.query) {
    return decodeSearchQuery(String(route.params.query));
  }
  return String(route.query.query || '');
});

const { fetchSentences, fetchStats } = useSearchFetch();

const { favoriteMediaIds } = useFavoriteMedia();
const { entries: familiarMedia, load: loadFamiliarMedia } = useFamiliarMedia();

// Break equal-ranked results toward starred and familiar titles; signed-out renders use neither.
// Cold SSR uses favourites alone while the tally loads in parallel. Waiting for it
// would add a round trip just to reorder ties; subsequent searches use the cached tally.
const preferMedia = computed<string[]>(() => {
  if (!userStore().isLoggedIn) return [];

  const ids = new Set(favoriteMediaIds.value);
  for (const entry of familiarMedia.value) ids.add(entry.media.publicId);
  return [...ids];
});

const searchScope = computed<SearchScope>(() => ({
  query: searchQuery.value,
  // A named media scope overrides the default category, matching SearchContainer.
  category:
    routeFilters.value.category ??
    (mediaQueryParam.value ? 'all' : defaultCategorySlug.value),
  mediaPublicId: mediaQueryParam.value,
  episode: episodeNumberParam.value,
  sort: routeFilters.value.sort,
  // Apply shared random seeds during SSR too, avoiding a different shuffle at hydration.
  randomSeed: routeFilters.value.randomSeed,
  segmentPublicId: routeFilters.value.segmentPublicId,
  collectionId: null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  hiddenMediaExclude: hiddenMediaExcludeFilter.value,
  hiddenCategories: hiddenCategories.value,
  preferMedia: preferMedia.value,
}));

const fetchSentenceData = async () => {
  const outcome = await fetchSentences(searchScope.value);
  // Strip unread fields before serializing the hydration payload.
  return outcome.status === 'ok' ? { ...outcome, data: stripUnreadTokenFields(outcome.data) } : outcome;
};

const fetchStatsData = async () => {
  const outcome = await fetchStats(searchScope.value);
  if (outcome.status === 'ok') {
    // Keep episode counts only for the URL's title; its drawer and meta description need them.
    return { ...outcome, data: stripEpisodeHits(outcome.data, mediaQueryParam.value) };
  }
  // fetchStats already reports failures with response context; do not report a duplicate.
  return outcome;
};

// Include the resolved default category: the same URL can represent different searches.
const sentenceCacheKey = computed(() => {
  const params = [
    searchQuery.value,
    route.query.uuid,
    searchScope.value.category,
    mediaQueryParam.value,
    episodeQueryParam.value,
    route.query.sort,
  ]
    .filter(Boolean)
    .join('-');
  return `search-sentence-outcomes-${params || 'default'}`;
});

const statsCacheKey = computed(() => {
  const params = [searchQuery.value, searchScope.value.category, mediaQueryParam.value, episodeQueryParam.value]
    .filter(Boolean)
    .join('-');
  return `search-stats-outcomes-${params || 'default'}`;
});

const sdk = useNadeshikoSdk();

// Skip expensive per-media/episode aggregations for crawlers: unique-query cache growth
// previously caused backend OOMs (Nadeshiko#522). Result totals still come from sentences;
// only the category breakdown in the meta description is lost. Any crawler replacement
// should use bounded category buckets, not restore the full aggregation.
const rendersForCrawler = useRequestTraffic() === 'bot';

// Reuse familiar-media rankings across queries, but scope the cache to the account
// so switching users without a reload cannot reuse the previous reader's ranking.
const familiarMediaCacheKey = computed(() => `familiar-media-${userStore().userEmail ?? 'anonymous'}`);

const [{ data: initialSentenceOutcome }, { data: initialStatsOutcome }, , { data: scopedMedia }] = await Promise.all([
  useAsyncData(sentenceCacheKey.value, () => fetchSentenceData(), {
    server: true,
    lazy: false,
    watch: [],
  }),
  useAsyncData(statsCacheKey.value, () => fetchStatsData(), {
    server: !rendersForCrawler,
    lazy: false,
    watch: [],
  }),
  // Load rankings during SSR to avoid reshuffling the filter list after hydration.
  useAsyncData(familiarMediaCacheKey.value, () => loadFamiliarMedia(), {
    server: true,
    lazy: false,
    watch: [],
  }),
  // ?media= is not part of the page key; watch it to replace the card without a remount.
  useAsyncData(
    () => `search-scoped-media-${mediaQueryParam.value ?? 'none'}`,
    async () => {
      const id = mediaQueryParam.value;
      if (!id) return null;
      // Repeated title lookups use the shared server/utils/mediaCache.ts cache.
      const load = async () => {
        if (!import.meta.server) return sdk.getMedia(id);
        const { cachedMedia } = await import('~~/server/utils/mediaCache');
        return cachedMedia(id, () => sdk.getMedia(id));
      };
      return load().catch((error: unknown) => {
        reportError('search:scoped-media-fetch-failed', error, { 'media.publicId': id });
        return null;
      });
    },
    { server: true, lazy: false, watch: [mediaQueryParam], default: () => null as Media | null },
  ),
]);

const initialSentenceData = computed(() =>
  initialSentenceOutcome.value?.status === 'ok' ? initialSentenceOutcome.value.data : null,
);
const initialStatsData = computed(() =>
  initialStatsOutcome.value?.status === 'ok' ? initialStatsOutcome.value.data : null,
);
if (initialSentenceOutcome.value?.status === 'forbidden' || initialStatsOutcome.value?.status === 'forbidden') {
  await navigateTo(localePath('/'), { redirectCode: 302 });
}

// Permanently redirect legacy title-only browse URLs using the slug already fetched.
// Word searches keep their scoped URL; ?uuid= belongs to search-redirect.ts.
const browsedMediaSlug = computed(() => {
  if (!mediaQueryParam.value || searchQuery.value || route.query.uuid) return null;
  const fromStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === mediaQueryParam.value)?.slug;
  return fromStats ?? initialSentenceData.value?.results?.[0]?.media?.slug ?? null;
});

if (browsedMediaSlug.value) {
  await navigateTo(localePath(buildMediaPath(browsedMediaSlug.value, episodeNumberParam.value)), {
    redirectCode: 301,
    replace: true,
  });
}

// Noindex only confirmed empty results, never failed fetches; keep follow for useful links.
// useRobotsRule updates the robots module's own rule, which wins meta-tag deduplication.
// Locale-wide indexing policy remains in route rules.
const emptyResultPage = computed(() => {
  const data = initialSentenceData.value;
  if (!searchQuery.value || data == null) return false;
  return (data.pagination?.estimatedTotalHits ?? data.results?.length ?? 0) === 0;
});
useRobotsRule(emptyResultPage.value ? 'noindex, follow' : undefined);

const requestOrigin = useRequestURL().origin;
const metaTags = computed(() => {
  const defaultTitle = t('seo.search.title');
  const defaultDescription = t('seo.search.defaultDescription');

  const tags = buildDefaultMetaTags(defaultTitle, defaultDescription);

  const result = initialSentenceData.value?.results?.[0];
  const q = searchQuery.value;

  if (route.query.uuid && result) {
    const sentenceTags = buildSentenceMetaTags(
      result,
      mediaName,
      (n) => t('seo.sentence.episode', { n }),
      (sentence, media) => t('seo.sentence.pageTitle', { sentence, media }),
    );
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
      const countNum = formatNumber(totalResults);
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
              count: formatNumber(s.count ?? 0),
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
    // Indexable word pages need descriptive titles; share-card titles stay short.
    tags.title = pageTitle(t('seo.search.wordTitle', { query: q }));
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
    const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === mediaQueryParam.value);
    return buildMediaMetaTags(
      {
        name: firstResult ? mediaName(firstResult.media) : '',
        bannerUrl: firstResult?.media?.bannerUrl,
        origin: requestOrigin,
        totalResults: mediaStats?.matchCount || 0,
        episodeHits: mediaStats?.episodeHits,
        episode: episodeNumberParam.value,
      },
      t,
      formatNumber,
    );
  }

  return tags;
});

useHead(metaTags);

// Curated word collections use CollectionPage, not SearchResultsPage: they are permanent
// indexable pages, not the internal search results Google advises excluding.
const breadcrumbItems = computed(() => {
  const items = [{ name: t('navbar.buttons.home'), item: localePath('/') }];

  // Emit only the matching parent: catalogue for media, search for words.
  if (mediaQueryParam.value) {
    items.push({ name: t('seo.media.title'), item: localePath('/media') });
    const firstResult = initialSentenceData.value?.results?.[0];
    if (firstResult) {
      items.push({ name: mediaName(firstResult.media), item: route.fullPath });
    }
  } else if (searchQuery.value) {
    items.push({ name: t('seo.search.title'), item: localePath('/search') });
    items.push({ name: searchQuery.value, item: route.path });
  } else {
    items.push({ name: t('seo.search.title'), item: localePath('/search') });
  }

  return items;
});

const schemaOrgNodes = computed(() => [
  defineWebPage({ '@type': 'CollectionPage' }),
  defineBreadcrumb({ itemListElement: breadcrumbItems.value }),
]);

useSchemaOrg(schemaOrgNodes);
</script>

<template>
    <div class="mx-auto">
            <div class="relative text-white">
                    <div class="nd-page">
                        <h1 v-if="searchQuery" class="sr-only">{{ searchQuery }}</h1>
                        <div class="px-4 md:px-0">
                            <SearchBaseInputSegment />
                        </div>
                        <SearchContainer
                            :initial-sentence-outcome="initialSentenceOutcome"
                            :initial-stats-outcome="initialStatsOutcome"
                            :media-display-name="scopedMedia ? mediaName(scopedMedia) : null">
                            <!-- Keep the hero below tabs. Use the requested scope; scopedMedia can lag a tick. -->
                            <template #below-tabs>
                                <MediaHeader v-if="scopedMedia && mediaQueryParam" :media="scopedMedia" heading="h2" />
                            </template>
                        </SearchContainer>
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
