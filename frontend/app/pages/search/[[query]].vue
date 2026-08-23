<script setup lang="ts">
import { stripEpisodeHits, stripUnreadTokenFields, type SearchScope } from '~/composables/useSearchFetch';
import {
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_SIZE,
  buildDefaultMetaTags,
  buildOgImageTags,
  buildSentenceMetaTags,
  pageTitle,
  socialTitle,
} from '~/utils/metaTags';
import type { Media } from '@brigadasos/nadeshiko-sdk';
import { reportError } from '~/utils/reportError';
import { buildMediaPath, decodeSearchQuery } from '~/utils/routes';

definePageMeta({
  // All from `/media/<slug>` only changes the path because the title lives in
  // it. Nuxt treats that as a new page and would jump to the top; the reader
  // is still in the same list.
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

const { favoriteMediaIds } = useFavoriteMedia();
const { entries: familiarMedia, load: loadFamiliarMedia } = useFamiliarMedia();

/**
 * The reader's own titles, for the tie-break the backend applies under the
 * default order: among segments Elasticsearch ranked equally, theirs first.
 *
 * Both halves of "their titles" -- the ones they starred, and the ones the
 * activity tally infers they already know -- because the filter sidebar already
 * treats the two the same way, and a reader who has to star a show they watch
 * every week to get it treated as theirs has been asked to state something the
 * app worked out on its own.
 *
 * Signed-out is empty rather than falling back to anything local. Nothing here
 * is worth guessing at from a device: the whole list describes a person, and the
 * page renders the same for everyone who has not said who they are.
 *
 * One honest gap: on a cold server render the tally is still in flight beside
 * this search rather than ahead of it, so that first page is tie-broken on
 * favourites alone. Making the search wait would put a round trip in front of
 * every signed-in render to reorder rows within a tie, which is the wrong trade
 * -- and by the reader's next search the ranking is in `useState` and both
 * halves are sent.
 */
const preferMedia = computed<string[]>(() => {
  if (!userStore().isLoggedIn) return [];

  const ids = new Set(favoriteMediaIds.value);
  for (const entry of familiarMedia.value) ids.add(entry.media.publicId);
  return [...ids];
});

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
  preferMedia: preferMedia.value,
}));

const fetchSentenceData = async () => {
  const outcome = await fetchSentences(searchScope.value);
  // Slimmed before it is handed back, because what this returns IS the hydration
  // payload: see `stripUnreadTokenFields`.
  return outcome.status === 'ok' ? stripUnreadTokenFields(outcome.data) : null;
};

const fetchStatsData = async () => {
  const outcome = await fetchStats(searchScope.value);
  if (outcome.status === 'ok') {
    // Per-episode counts only for a title the URL actually named. A word search
    // names none, so all 492 of the pairs it was carrying go; `?media=` keeps
    // the one the meta description and the open drawer both read.
    return stripEpisodeHits(outcome.data, mediaQueryParam.value);
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

const sdk = useNadeshikoSdk();

/**
 * THE STATS CALL IS NOT MADE FOR A CRAWLER, and this is the one guard on the
 * page that changes what gets rendered rather than only how fast.
 *
 * `/v1/search/stats` is the most expensive thing a search render asks for: an
 * Elasticsearch aggregation over every media and every episode that matches,
 * cached on the backend under a key that is the query plus every filter. A
 * crawler walks a new query per request, so every one of those renders minted a
 * cache entry nobody would ever read again -- 48k bot calls per 6h against 1.6k
 * from readers (measured 2026-08-22), and a backend that OOM-killed every three
 * hours because of it (Nadeshiko#522).
 *
 * WHAT A CRAWLER LOSES: the per-category breakdown clause in the meta
 * description ("N from anime, M from drama"). The result count itself comes
 * from the sentences call's `estimatedTotalHits` and is unaffected, as are the
 * title, the results, and every link on the page. The filter panel's counts are
 * a reader control that a crawler does not render.
 *
 * If that breakdown turns out to be worth keeping for search engines, the fix
 * is a stats request that asks only for the category buckets -- cheap, bounded,
 * and cacheable under a key with no query in it -- not turning this back on.
 */
const rendersForCrawler = useRequestTraffic() === 'bot';

/**
 * User-scoped, unlike the two keys above, because the ranking is about months of
 * study and does not change between queries -- one fetch serves every search in
 * the session. The identity is folded into the key so signing out and back in
 * without a reload cannot serve the previous reader's ranking from the cache.
 */
const familiarMediaCacheKey = computed(() => `familiar-media-${userStore().userEmail ?? 'anonymous'}`);

const [{ data: initialSentenceData }, { data: initialStatsData }, , { data: scopedMedia }] = await Promise.all([
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
  // Loaded server-side with the rest so the filter renders already ordered.
  // Fetching it client-side would sort the list a second time after hydration,
  // moving rows under the cursor of someone reaching for one.
  useAsyncData(familiarMediaCacheKey.value, () => loadFamiliarMedia(), {
    server: true,
    lazy: false,
    watch: [],
  }),
  // The title card for a search narrowed to one show. Watched: `?media=` is
  // not part of the page key, so picking a different title in the sidebar
  // must replace the card without remounting the page.
  useAsyncData(
    () => `search-scoped-media-${mediaQueryParam.value ?? 'none'}`,
    async () => {
      const id = mediaQueryParam.value;
      if (!id) return null;
      // Server-side this goes through the shared media cache: `?media=` is in
      // the sitemap for every title, so a crawl asks for the same few hundred
      // records over and over. See `server/utils/mediaCache.ts`.
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

/**
 * The kanji relatives linked at the foot of a word page.
 *
 * Fetched with the page rather than by the component, so the links are in the
 * server-rendered HTML -- these exist to give ~19.8k otherwise-orphan word pages
 * something linking to them, and a link a crawler never receives does nothing.
 *
 * Word pages only: a title browse has the catalogue linking it onward, and a
 * bare `/search` has nothing to be related to. The route answers from an
 * in-memory index and is `swr`-cached for a day, so this is not a backend hop.
 */
const { data: relatedWordsData } = await useAsyncData(
  () => `related-words-${searchQuery.value || 'none'}`,
  () => {
    if (!searchQuery.value || mediaQueryParam.value) return Promise.resolve({ words: [] });
    return $fetch<{ words: { word: string; matchCount: number }[] }>('/api/words/related', {
      query: { word: searchQuery.value },
      // A missing related-words list is not worth an error page.
    }).catch(() => ({ words: [] }));
  },
  { default: () => ({ words: [] }), watch: [] },
);

const relatedWords = computed(() => relatedWordsData.value?.words ?? []);

/**
 * A QUERY THAT FOUND NOTHING IS NOT A PAGE WORTH INDEXING, and this route mints
 * them without limit: `/search/<anything>` answers 200 for any string,
 * self-canonicalises, and advertises a Spanish twin of itself. The sitemap
 * submits 19,784 curated word searches; everything else typed, linked or
 * guessed at is the same template over an empty result set, competing with
 * them. Crawlers do walk it -- that enumeration is what filled the search-stats
 * cache until the backend ran out of heap.
 *
 * `follow`, not `noindex, nofollow`: the page still carries the nav and the
 * related-word links, and they lead somewhere worth having.
 *
 * ONLY WHEN THE EMPTINESS IS KNOWN. `initialSentenceData` is null when the SSR
 * fetch FAILED as well as when it returned nothing, and the two must not be
 * treated alike -- a backend blip would otherwise de-index good pages wholesale,
 * which is far more expensive than briefly indexing a thin one.
 *
 * THROUGH `useRobotsRule`, NOT A `robots` META IN `metaTags` BELOW, and the
 * difference is not stylistic: @nuxtjs/robots renders its meta from
 * `event.context.robots.rule` and wins the dedupe against a hand-pushed tag.
 * This page used to push `noindex, follow` for `/ja` that way, and production
 * served `noindex, nofollow` on those pages regardless -- the module's value,
 * from `'/ja/**': { robots: false }`. That branch was removed rather than
 * ported: the route rule already says what it was trying to say, and it says it
 * where the rest of the estate's indexing rules live. This composable sets the
 * rule the module itself renders, so it survives.
 */
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
    // The `<title>` was the bare word -- `食べる` and nothing else -- on ~19.8k
    // indexed pages. The share card stays short; see `pageTitle` for why these
    // are no longer the same string.
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
    const animeName = firstResult ? mediaName(firstResult.media) : '';
    const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === mediaQueryParam.value);

    const filterEpisode = episodeNumberParam.value;

    let totalResults = mediaStats?.matchCount || 0;
    const episodeHits = mediaStats?.episodeHits;

    if (episodeHits && filterEpisode) {
      totalResults = episodeHits.find((h) => h.episode === filterEpisode)?.hitCount ?? 0;
    }

    const title = animeName;
    const count = formatNumber(totalResults);
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
    tags.title = pageTitle(t('seo.media.pageTitle', { media: title }));
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
                    <div class="nd-page">
                        <h1 v-if="searchQuery" class="sr-only">{{ searchQuery }}</h1>
                        <div class="px-4 md:px-0">
                            <SearchBaseInputSegment />
                        </div>
                        <SearchContainer
                            :initial-sentence-data="initialSentenceData"
                            :initial-stats-data="initialStatsData"
                            :media-display-name="scopedMedia ? mediaName(scopedMedia) : null">
                            <!-- Same slot as the title page, so leaving a
                                 narrowed search does not move the tabs either.
                                 `mediaQueryParam` is what the reader asked for;
                                 `scopedMedia` can lag a tick behind. -->
                            <template #below-tabs>
                                <MediaHeader v-if="scopedMedia && mediaQueryParam" :media="scopedMedia" heading="h2" />
                            </template>
                        </SearchContainer>
                        <!-- Word pages only: a title browse has the catalogue to
                             link it onward, and a bare `/search` has nothing to
                             be related to. -->
                        <SearchRelatedWords :words="relatedWords" />
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
