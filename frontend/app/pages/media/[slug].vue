<script setup lang="ts">
import type { Media } from '@brigadasos/nadeshiko-sdk';
import { stripEpisodeHits, stripUnreadTokenFields, type SearchScope } from '~/composables/useSearchFetch';
import {
  DEFAULT_OG_IMAGE_PATH,
  DEFAULT_OG_IMAGE_SIZE,
  buildDefaultMetaTags,
  buildOgImageTags,
  pageTitle,
  socialTitle,
} from '~/utils/metaTags';
import { apiErrorStatus, isMissing } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import { mediaSameAsUrls } from '~/utils/media';

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

// Follow the path only while it still names a title. Leaving for `/search`
// clears `params.slug`; watching that would refetch `/api/media/by-slug/undefined`,
// null out `media`, and fire the 404 watcher on a page that is merely the
// outgoing Suspense fallback.
const slug = ref(String(route.params.slug));
watch(
  () => route.params.slug,
  (next) => {
    if (typeof next === 'string' && next) slug.value = next;
  },
);

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
        // 400 as well as 404: the id pattern is enforced by the API, so a
        // malformed one is rejected before the lookup and means the same thing
        // to a reader -- no such page. See `isMissing`.
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

// `useAsyncData` refetches when the slug changes but setup runs once, so a
// client-side hop to a missing title would otherwise keep this component alive
// and render a blank body instead of the error page.
watch([media, mediaError], ([entry, error]) => {
  if (!isMediaPage.value) return;
  if (error) {
    showError(createError({ statusCode: 500, statusMessage: 'Failed to load media' }));
  } else if (!entry) {
    showError(createError({ statusCode: 404, statusMessage: 'Media Not Found' }));
  }
});

const mediaPublicId = computed(() => media.value?.publicId ?? null);

/** The title's name on its own: the heading and the breadcrumb, not the `<title>`. */
const headline = computed(() => (media.value ? mediaName(media.value) : t('seo.media.title')));

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

/**
 * Whether the first load of the results actually failed.
 *
 * `fetchSentences` can answer `error`, `forbidden` or `stale`, and all three
 * used to be flattened into `null` -- which renders exactly like a title with no
 * segments. A reader whose request failed during a sign-in was told the show was
 * empty, and nothing anywhere said otherwise. Tracked separately rather than by
 * changing what is handed to `SearchContainer`, so the shared component's
 * contract is untouched: `null` still means "nothing to seed with", and this
 * says whether that was a real answer.
 */
const sentencesFailed = ref(false);

const [{ data: initialSentenceData, refresh: refreshSentences }, { data: initialStatsData, refresh: refreshStats }] =
  await Promise.all([
    useAsyncData(
      () => `media-sentences-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
      async () => {
        const outcome = await fetchSentences(searchScope.value);
        sentencesFailed.value = outcome.status !== 'ok';
        // Slimmed before it is handed back, because what this returns IS the
        // hydration payload: see `stripUnreadTokenFields`.
        return outcome.status === 'ok' ? stripUnreadTokenFields(outcome.data) : null;
      },
      { server: true, lazy: false, watch: [] },
    ),
    useAsyncData(
      () => `media-stats-${slug.value}-${episodeNumberParam.value ?? 'all'}`,
      async () => {
        const outcome = await fetchStats(searchScope.value);
        // Failures are reported inside `fetchStats`, which still has the response
        // and can tell a 403 apart from a real error.
        if (outcome.status !== 'ok') return null;
        // Every OTHER title's per-episode counts leave here: 4,670 of the 5,802
        // objects this page used to serialize. This title's stay -- they are the
        // episode list the drawer opens on, and `metaTags` below counts them.
        return stripEpisodeHits(outcome.data, mediaPublicId.value);
      },
      { server: true, lazy: false, watch: [] },
    ),
  ]);

const reloadResults = async () => {
  await Promise.all([refreshSentences(), refreshStats()]);
};

/**
 * Re-resolve the results when the session changes.
 *
 * Both fetches pass `watch: []`, so nothing refetched for the life of the page
 * -- but what these return depends on the viewer: hidden media, hidden
 * categories, content rating and translation languages all feed `searchScope`.
 * Signing in or out therefore has to re-ask, or the reader keeps looking at
 * somebody else's answer until they navigate.
 */
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

  const title = mediaName(entry);
  const social = socialTitle(title);

  const mediaStats = initialStatsData.value?.media?.find((s) => s.mediaPublicId === entry.publicId);
  const episodeHits = mediaStats?.episodeHits;
  const filterEpisode = episodeNumberParam.value;

  let totalResults = mediaStats?.matchCount ?? 0;
  if (episodeHits && filterEpisode) {
    totalResults = episodeHits.find((h) => h.episode === filterEpisode)?.hitCount ?? 0;
  }

  const count = formatNumber(totalResults);
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
    title: pageTitle(t('seo.media.pageTitle', { media: title })),
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

/**
 * The work itself, alongside the page that lists its sentences.
 *
 * A `CollectionPage` says "this page is a list"; it says nothing about WHAT the
 * list is about. `TVSeries`/`Movie` is what tells a search engine this URL is
 * the page for a named work with a studio, a season and an air date -- the
 * entity a reader is looking for when they search the title. Everything below
 * comes from the payload the header already renders, so the markup and the page
 * cannot disagree.
 *
 * `Movie` is chosen off `airingFormat`, the same field `MediaCountLabel` uses to
 * decide whether to say "12 episodes" or "Movie". YouTube channels are neither,
 * so they get no work node rather than a wrong one.
 */
const workSchema = computed(() => {
  const entry = media.value;
  if (!entry || entry.category === 'YOUTUBE') return null;

  // `Record<string, unknown>`, the same shape `[...slug].vue` gives `defineArticle`
  // and for the same reason: these builders are generic over the object handed to
  // them and INTERSECT it with the schema type, so an inferred `genre: string[]`
  // meets a declared `string | string[]` and collapses to `string & string[]` --
  // a type nothing can satisfy. Widening here keeps the intersection harmless.
  const sameAs = mediaSameAsUrls(entry);

  // THE TWO NAMES THIS READER IS NOT SEEING. `name` is `mediaName`, which
  // resolves against the reader's `mediaNameLanguage` preference and the locale
  // -- so the entity was advertising exactly one of a title's three names, and
  // which one depended on who was looking. Search Console for the 3 months to
  // 2026-08-25 has readers arriving on all three forms: `kaguya-sama wa
  // kokurasetai` and `各務原なでしこ` and `seihantaina kimi`. `alternateName` is
  // where a work's other titles go, and it is what lets those three queries
  // resolve to one entity instead of competing for it.
  //
  // Deduplicated against `name` and against each other: a title whose romaji and
  // English forms are identical, or which carries only one name, must not claim
  // an alternate that is the name it already gave.
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
            <!-- Searching from a title page stays inside that title; the scope
                 lives in the path here, so the box has to be told what it is. -->
            <SearchBaseInputSegment :scope-media-id="mediaPublicId" />
          </div>
          <!-- A failed load, said out loud. Without this the page renders exactly
               like a title with no segments, and the reader has no way to tell
               "nothing here" from "we could not ask". Above the results rather
               than replacing them: whatever did arrive is still worth showing. -->
          <div
            v-if="sentencesFailed"
            data-testid="media-results-error"
            class="mx-4 md:mx-0 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm"
          >
            <span class="text-red-200">{{ t('mediaPage.resultsFailed') }}</span>
            <button class="nd-btn" @click="reloadResults">{{ t('mediaPage.resultsRetry') }}</button>
          </div>

          <SearchContainer
            :initial-sentence-data="initialSentenceData"
            :initial-stats-data="initialStatsData"
            :media-public-id="mediaPublicId">
            <!-- Below the tabs, not above the search box: a hero above the
                 tabs would make them jump when it left. -->
            <template #below-tabs>
              <MediaHeader v-if="media" :media="media" />
            </template>
          </SearchContainer>
        </div>
    </div>
  </div>
</template>
