<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';
import { stripEpisodeHits, stripUnreadTokenFields, type SearchScope } from '~/composables/useSearchFetch';
import { buildDefaultMetaTags, buildMediaMetaTags } from '~/utils/metaTags';
import { apiErrorStatus, isMissing } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import { mediaSameAsUrls } from '~/utils/media';
import { readSearchRouteFilters } from '~/utils/routes';

// Title browse lives at /media/<slug>; legacy /search?media= URLs redirect here.
// Pass the scope as a prop so filter updates cannot remove the title from the path.

const { t } = useI18n();
const { formatNumber } = useFormat();
const route = useRoute();
const localePath = useLocalePath();
const { mediaName } = useMediaName();
const { isMediaPage } = useMediaScope();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const { hiddenMediaExcludeFilter } = useHiddenMedia();
const { hiddenCategories } = useHiddenCategories();
const { fetchSentences, fetchStats } = useSearchFetch();

// Ignore a cleared slug while leaving this route; refetching it would 404 the outgoing Suspense page.
const slug = ref(String(route.params.slug));
watch(
  () => route.params.slug,
  (next) => {
    if (typeof next === 'string' && next) slug.value = next;
  },
);

// This route accepts only these filters: legacy episodeId and seed stay ignored.
const routeFilters = computed(() => readSearchRouteFilters({
  category: route.query.category,
  episode: route.query.episode,
  sort: route.query.sort,
}));
const episodeNumberParam = computed(() => routeFilters.value.episode);

const { data: media, error: mediaError } = await useAsyncData<Media | null>(
  () => `media-by-slug-${slug.value}`,
  () =>
    $fetch<Media>(`/api/media/by-slug/${encodeURIComponent(slug.value)}`).catch(
      (fetchError: { statusCode?: number; status?: number }) => {
        // Treat malformed/missing slugs (400/404) as absent; propagate lookup failures.
        if (isMissing(apiErrorStatus(fetchError))) return null;
        reportError('media:slug-resolve-failed', fetchError, { 'media.slug': slug.value });
        throw fetchError;
      },
    ),
  { watch: [slug] },
);

if (mediaError.value) {
  throw createError({ statusCode: 500, statusMessage: 'Failed to load media' });
}
if (!media.value) {
  throw createError({ statusCode: 404, statusMessage: 'Media Not Found' });
}

// Setup runs once; handle lookup errors on subsequent slug changes too.
watch([media, mediaError], ([entry, error]) => {
  if (!isMediaPage.value) return;
  if (error) {
    showError(createError({ statusCode: 500, statusMessage: 'Failed to load media' }));
  } else if (!entry) {
    showError(createError({ statusCode: 404, statusMessage: 'Media Not Found' }));
  }
});

const mediaPublicId = computed(() => media.value?.publicId ?? null);

const headline = computed(() => (media.value ? mediaName(media.value) : t('seo.media.title')));

const searchScope = computed<SearchScope>(() => ({
  query: '',
  // A named title overrides the reader's default category, as on ?media= searches.
  category: routeFilters.value.category ?? 'all',
  mediaPublicId: mediaPublicId.value,
  episode: episodeNumberParam.value,
  sort: routeFilters.value.sort,
  randomSeed: null,
  segmentPublicId: null,
  collectionId: null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  hiddenMediaExclude: hiddenMediaExcludeFilter.value,
  hiddenCategories: hiddenCategories.value,
}));

const [
  { data: initialSentenceOutcome, refresh: refreshSentences },
  { data: initialStatsOutcome, refresh: refreshStats },
] = await Promise.all([
  useAsyncData(
    () => `media-sentence-outcomes-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
    async () => {
      const outcome = await fetchSentences(searchScope.value);
      // Strip unread fields before serializing the hydration payload.
      return outcome.status === 'ok' ? { ...outcome, data: stripUnreadTokenFields(outcome.data) } : outcome;
    },
    { server: true, lazy: false, watch: [] },
  ),
  useAsyncData(
    () => `media-stats-outcomes-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
    async () => {
      const outcome = await fetchStats(searchScope.value);
      // fetchStats reports failures while it still has the response status.
      if (outcome.status !== 'ok') return outcome;
      // Keep episode counts only for this title; its drawer and meta description need them.
      return { ...outcome, data: stripEpisodeHits(outcome.data, mediaPublicId.value) };
    },
    { server: true, lazy: false, watch: [] },
  ),
]);

const initialStatsData = computed(() =>
  initialStatsOutcome.value?.status === 'ok' ? initialStatsOutcome.value.data : null,
);
if (initialSentenceOutcome.value?.status === 'forbidden' || initialStatsOutcome.value?.status === 'forbidden') {
  await navigateTo(localePath('/'), { redirectCode: 302 });
}

const reloadResults = async () => {
  await Promise.all([refreshSentences(), refreshStats()]);
};

// watch: [] disables automatic refetching, but session changes alter viewer-specific search filters.
watch(
  () => userStore().isLoggedIn,
  () => {
    void reloadResults();
  },
);

const requestOrigin = useRequestURL().origin;

const metaTags = computed(() => {
  const entry = media.value;
  if (!entry) return buildDefaultMetaTags(t('seo.media.title'), t('seo.media.description'));

  const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === entry.publicId);
  return buildMediaMetaTags(
    {
      name: mediaName(entry),
      bannerUrl: entry.bannerUrl,
      origin: requestOrigin,
      totalResults: mediaStats?.matchCount ?? 0,
      episodeHits: mediaStats?.episodeHits,
      episode: episodeNumberParam.value,
    },
    t,
    formatNumber,
  );
});

useHead(metaTags);

// Describe the work as well as the sentence list. Match MediaCountLabel's airingFormat policy;
// YouTube channels are neither movies nor TV series and get no work node.
const workSchema = computed(() => {
  const entry = media.value;
  if (!entry || entry.category === 'YOUTUBE') return null;

  // Widen schema input to avoid generic intersections such as string & string[].
  const sameAs = mediaSameAsUrls(entry);

  // Publish the other language titles as aliases, excluding the displayed name and duplicates.
  const alternateNames = [entry.nameJa, entry.nameRomaji, entry.nameEn]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value) && value !== headline.value.trim())
    .filter((value, index, all) => all.indexOf(value) === index);

  const shared: Record<string, unknown> = {
    name: headline.value,
    ...(alternateNames.length ? { alternateName: alternateNames } : {}),
    ...(entry.genres?.length ? { genre: entry.genres } : {}),
    ...(entry.coverUrl ? { image: entry.coverUrl } : {}),
    ...(entry.startDate ? { datePublished: entry.startDate } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    inLanguage: 'ja',
  };

  if (entry.airingFormat === 'MOVIE') return defineMovie(shared);

  return defineTVSeries({
    ...shared,
    ...(entry.episodeCount ? { numberOfEpisodes: entry.episodeCount } : {}),
  });
});

useSchemaOrg(
  computed(() => [
    defineWebPage({ '@type': 'CollectionPage' }),
    defineBreadcrumb({
      itemListElement: [
        { name: t('navbar.buttons.home'), item: localePath('/') },
        { name: t('seo.media.title'), item: localePath('/media') },
        { name: headline.value, item: route.path },
      ],
    }),
    ...(workSchema.value ? [workSchema.value] : []),
  ]),
);
</script>

<template>
  <div class="mx-auto">
    <div class="relative text-white">
        <div class="nd-page">
          <div class="px-4 md:px-0">
            <!-- The path holds the title scope; pass it explicitly to the search box. -->
            <SearchBaseInputSegment :scope-media-id="mediaPublicId" />
          </div>
          <SearchContainer
            :initial-sentence-outcome="initialSentenceOutcome"
            :initial-stats-outcome="initialStatsOutcome"
            :media-public-id="mediaPublicId">
            <!-- Keep the hero below the tabs so removing it does not move them. -->
            <template #below-tabs>
              <MediaHeader v-if="media" :media="media" />
            </template>
          </SearchContainer>
        </div>
    </div>
  </div>
</template>
