<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';
import type { SearchScope } from '~/composables/useSearchFetch';
import {
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_SIZE,
  buildDefaultMetaTags,
  buildOgImageTags,
  socialTitle,
} from '~/utils/metaTags';
import { reportError } from '~/utils/reportError';

/**
 * A title's own page.
 *
 * This is the same view `/search?media=<publicId>` has always rendered; what
 * changed is the URL it lives at. Those 317 filter-parameter URLs were what the
 * sitemap submitted, and an opaque twelve-character id says nothing to a search
 * engine about a page whose whole subject is a named work. `/media/steins-gate`
 * does. The old URL now 301s here from the search page itself.
 *
 * Built as its own page rather than an alias of the search route, following
 * `collection/[id].vue`: fetch a scope, hand it to `SearchContainer`. The scope
 * arrives as a PROP here instead of as `?media=`, which is what keeps the title
 * in the path where filter clicks cannot patch it away.
 */

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const { mediaName } = useMediaName();
const { contentRating } = useContentRating();
const { includedLanguages } = useTranslationVisibility();
const { hiddenMediaExcludeFilter } = useHiddenMedia();
const { hiddenCategories } = useHiddenCategories();
const { fetchSentences, fetchStats } = useSearchFetch();

const slug = computed(() => String(route.params.slug));

const episodeNumberParam = computed(() => {
  const raw = getStringQueryValue(route.query.episode as string | string[] | undefined);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
});

const { data: media, error: mediaError } = await useAsyncData<Media | null>(
  () => `media-by-slug-${slug.value}`,
  () =>
    $fetch<Media>(`/api/media/by-slug/${encodeURIComponent(slug.value)}`).catch(
      (fetchError: { statusCode?: number; status?: number }) => {
        // A retired or mistyped slug is a genuine 404; anything else is our own
        // lookup failing and must not be dressed up as "this title does not exist".
        const status = fetchError?.statusCode ?? fetchError?.status;
        if (status === 404) return null;
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

// `useAsyncData` refetches when the slug changes but setup runs once, so a
// client-side hop to a missing title would otherwise keep this component alive
// and render a blank body instead of the error page.
watch([media, mediaError], ([entry, error]) => {
  if (error) {
    showError(createError({ statusCode: 500, statusMessage: 'Failed to load media' }));
  } else if (!entry) {
    showError(createError({ statusCode: 404, statusMessage: 'Media Not Found' }));
  }
});

const mediaPublicId = computed(() => media.value?.publicId ?? null);

const searchScope = computed<SearchScope>(() => ({
  query: '',
  // 'all', not the reader's default category: the title named in the path is the
  // subject, and one outside their default would otherwise come back empty on
  // its own page. Mirrors what the search page does when `?media=` is set.
  category: getStringQueryValue(route.query.category as string | string[] | undefined) ?? 'all',
  mediaPublicId: mediaPublicId.value,
  episode: episodeNumberParam.value,
  sort: getStringQueryValue(route.query.sort as string | string[] | undefined),
  randomSeed: null,
  segmentPublicId: null,
  collectionId: null,
  listMediaIds: null,
  contentRating: contentRating.value,
  languages: includedLanguages.value,
  hiddenMediaExclude: hiddenMediaExcludeFilter.value,
  hiddenCategories: hiddenCategories.value,
}));

const [{ data: initialSentenceData }, { data: initialStatsData }] = await Promise.all([
  useAsyncData(
    () => `media-sentences-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
    async () => {
      const outcome = await fetchSentences(searchScope.value);
      return outcome.status === 'ok' ? outcome.data : null;
    },
    { server: true, lazy: false, watch: [] },
  ),
  useAsyncData(
    () => `media-stats-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
    async () => {
      const outcome = await fetchStats(searchScope.value);
      // Failures are reported inside `fetchStats`, which still has the response
      // and can tell a 403 apart from a real error.
      return outcome.status === 'ok' ? outcome.data : null;
    },
    { server: true, lazy: false, watch: [] },
  ),
]);

const requestOrigin = useRequestURL().origin;

const metaTags = computed(() => {
  const entry = media.value;
  if (!entry) return buildDefaultMetaTags(t('seo.media.title'), t('seo.media.description'));

  const title = mediaName(entry);
  const social = socialTitle(title);

  const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === entry.publicId);
  const episodeHits = mediaStats?.episodeHits;
  const filterEpisode = episodeNumberParam.value;

  let totalResults = mediaStats?.matchCount ?? 0;
  if (episodeHits && filterEpisode) {
    totalResults = episodeHits.find((h) => h.episode === filterEpisode)?.hitCount ?? 0;
  }

  const count = totalResults.toLocaleString();
  let description = t('seo.search.mediaDescription', { count, media: title });

  if (episodeHits && episodeHits.length > 0) {
    description = filterEpisode
      ? t('seo.search.mediaDescriptionEpisode', { count, media: title, episode: filterEpisode })
      : t('seo.search.mediaDescriptionEpisodes', { count, media: title, episodeCount: episodeHits.length });
  }

  // Banner over cover, and the size declared only when it is actually known --
  // see `buildOgImageTags` for why the two must travel together.
  const bannerUrl = entry.bannerUrl;
  const ogImage = bannerUrl || `${requestOrigin}${DEFAULT_OG_IMAGE_PATH}`;

  return {
    title,
    meta: [
      { name: 'description', content: description },
      { property: 'og:title', content: social },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      ...buildOgImageTags(ogImage, bannerUrl ? undefined : DEFAULT_OG_IMAGE_SIZE),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: social },
      { name: 'twitter:description', content: description },
    ],
  };
});

useHead(metaTags);

useSchemaOrg(
  computed(() => [
    defineWebPage({ '@type': 'CollectionPage' }),
    defineBreadcrumb({
      itemListElement: [
        { name: t('navbar.buttons.home'), item: localePath('/') },
        { name: t('seo.media.title'), item: localePath('/media') },
        { name: metaTags.value.title, item: route.path },
      ],
    }),
  ]),
);
</script>

<template>
  <div class="mx-auto">
    <div class="relative text-white">
      <div class="pt-2">
        <div class="nd-page">
          <h1 class="sr-only">{{ metaTags.title }}</h1>
          <div class="px-4 md:px-0">
            <!-- Searching from a title page stays inside that title; the scope
                 lives in the path here, so the box has to be told what it is. -->
            <SearchBaseInputSegment :scope-media-id="mediaPublicId" />
          </div>
          <SearchContainer
            :initial-sentence-data="initialSentenceData"
            :initial-stats-data="initialStatsData"
            :media-public-id="mediaPublicId" />
        </div>
      </div>
    </div>
  </div>
</template>
