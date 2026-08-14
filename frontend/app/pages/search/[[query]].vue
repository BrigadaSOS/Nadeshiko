<script setup lang="ts">
import type { SearchScope } from '~/composables/useSearchFetch';
import {
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_SIZE,
  buildDefaultMetaTags,
  buildOgImageTags,
  buildSentenceMetaTags,
  socialTitle,
} from '~/utils/metaTags';
import { buildMediaPath, decodeSearchQuery, splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

const { mediaName } = useMediaName();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const { hiddenMediaExcludeFilter } = useHiddenMedia();
const { hiddenCategories } = useHiddenCategories();
const { defaultCategorySlug } = useDefaultSearchCategory();

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
    return decodeSearchQuery(String(route.params.query));
  }
  return String(route.query.query || '');
});

/** Same rule as `applyRouteQuery` in `SearchContainer`: non-negative integers only. */
const randomSeedParam = computed(() => {
  const raw = getStringQueryValue(route.query.seed as string | string[] | undefined);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
});

const { fetchSentences, fetchStats } = useSearchFetch();

const searchScope = computed<SearchScope>(() => ({
  query: searchQuery.value,
  // Mirrors `implicitCategorySlug` in `SearchContainer`: no `?category=` means the
  // reader's default, except when `?media=` already named the title to search --
  // one outside that category would otherwise come back empty.
  category:
    getStringQueryValue(route.query.category as string | string[] | undefined) ??
    (mediaQueryParam.value ? 'all' : defaultCategorySlug.value),
  mediaPublicId: mediaQueryParam.value,
  episode: episodeNumberParam.value,
  sort: getStringQueryValue(route.query.sort as string | string[] | undefined),
  // Sent on the server pass too, so a shared `?sort=random&seed=` link renders
  // the shuffle it names instead of the backend's day-seed one and then
  // reordering under the reader when the client takes over.
  randomSeed: randomSeedParam.value,
  segmentPublicId: getStringQueryValue(route.query.uuid as string | string[] | undefined),
  collectionId: null,
  listMediaIds: null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  hiddenMediaExclude: hiddenMediaExcludeFilter.value,
  hiddenCategories: hiddenCategories.value,
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
  // Failures are reported inside `fetchStats`, which still has the response and
  // can tell a 403 apart from a real error. Re-reporting the bare outcome here
  // only produced a stackless duplicate of something already captured.
  return null;
};

// Keyed on the *resolved* category rather than the raw `?category=`: with a
// default category set, the same URL means a different search than it does for a
// reader who kept "All", and both would otherwise share one cache entry.
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
  return `search-sentences-${params || 'default'}`;
});

const statsCacheKey = computed(() => {
  const params = [searchQuery.value, searchScope.value.category, mediaQueryParam.value, episodeQueryParam.value]
    .filter(Boolean)
    .join('-');
  return `search-stats-${params || 'default'}`;
});

const { load: loadFamiliarMedia } = useFamiliarMedia();

/**
 * User-scoped, unlike the two keys above, because the ranking is about months of
 * study and does not change between queries -- one fetch serves every search in
 * the session. The identity is folded into the key so signing out and back in
 * without a reload cannot serve the previous reader's ranking from the cache.
 */
const familiarMediaCacheKey = computed(() => `familiar-media-${userStore().userEmail ?? 'anonymous'}`);

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
  // Loaded server-side with the rest so the filter renders already ordered.
  // Fetching it client-side would sort the list a second time after hydration,
  // moving rows under the cursor of someone reaching for one.
  useAsyncData(familiarMediaCacheKey.value, () => loadFamiliarMedia(), {
    server: true,
    lazy: false,
    watch: [],
  }),
]);

/**
 * `/search?media=<publicId>` with nothing being searched is a title browse, and
 * that now lives at `/media/<slug>`. Permanent, because this URL was in the
 * sitemap for 317 titles and is what external links point at.
 *
 * Issued from here rather than from the HTTP middleware for one reason: the slug
 * is already in the payload this page just fetched, so the redirect costs no
 * extra backend call. Resolving it in middleware would mean a lookup on every
 * legacy hit.
 *
 * Only when the media filter is the WHOLE request. With a word (`/search/食べる`)
 * the page is a search narrowed to a title and keeps its own URL, and `?uuid=`
 * is a permalink that `search-redirect.ts` already owns.
 */
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

const requestOrigin = useRequestURL().origin;
const isJapaneseSearchRoute = computed(() => splitLocalePrefix(route.path).localePrefix === '/ja');

const metaTags = computed(() => {
  const defaultTitle = t('seo.search.title');
  const defaultDescription = t('seo.search.defaultDescription');

  const tags = buildDefaultMetaTags(defaultTitle, defaultDescription);

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

    // Banner before cover. Both are the title's own art, but a share card is a
    // landscape frame: the banner is ~1200x400 and survives it, while the cover
    // is a ~460x647 PORTRAIT poster that every platform centre-crops to a band
    // across its middle. The cover is not a fallback for the banner either --
    // some media have no banner, and for those the site card beats a poster
    // sliced in half.
    const bannerUrl = firstResult?.media?.bannerUrl;
    const ogImage = bannerUrl || `${requestOrigin}${DEFAULT_OG_IMAGE_PATH}`;

    const social = socialTitle(title);
    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      // No size for a banner: the height varies per title (391-400 across the
      // ones sampled), so the honest move is to let crawlers measure it.
      ...buildOgImageTags(ogImage, bannerUrl ? undefined : DEFAULT_OG_IMAGE_SIZE),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ];
  }

  return tags;
});

useHead(metaTags);

/**
 * `CollectionPage` for both branches, and NOT `SearchResultsPage` for the word
 * one.
 *
 * The word pages are the site's main indexable asset -- 20k of them are in the
 * sitemap -- and `SearchResultsPage` announced them as exactly the thing Google's
 * own guidance says to keep out of the index ("Don't let your internal search
 * results be crawled"). Nothing about the page fit that label anyway: the URL is
 * a permanent path, not a query the visitor typed, and what it lists is a curated
 * collection of sentences containing a word, which is what `CollectionPage`
 * means. The media branch has always used it.
 */
const breadcrumbItems = computed(() => {
  const items = [{ name: t('navbar.buttons.home'), item: localePath('/') }];

  // A media-scoped page sits under the catalogue; a word page sits under search.
  // Only the trail that matches the page is emitted -- a breadcrumb naming a
  // parent the page does not actually have is worse than none.
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
                <div class="pt-2">
                    <div class="nd-page">
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
