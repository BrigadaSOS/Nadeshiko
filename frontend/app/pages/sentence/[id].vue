<script setup lang="ts">
import { NadeshikoError } from '@brigadasos/nadeshiko-sdk';
import { buildDefaultMetaTags, buildSentenceMetaTags, socialTitle } from '~/utils/metaTags';
import { mediaBrowsePath } from '~/utils/routes';
import { resolveSearchResponse } from '~/utils/resolvers';
import { reportError } from '~/utils/reportError';
import type { SearchStatsResponse } from '~/types/search';

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const { mediaName } = useMediaName();

const id = computed(() => String(route.params.id));

/**
 * The segment itself, shared across visitors while rendering on the server.
 *
 * This page is the most expensive one the site serves and its data is identical
 * for everyone, so server-side renders go through a short cache that also
 * collapses simultaneous renders of the same permalink into one backend call --
 * the shape that took production down on 2026-08-09. The client keeps calling
 * the SDK directly: a browser has its own HTTP cache, and this store is
 * per-server-process.
 *
 * Dynamically imported so the server-only util never reaches the client bundle,
 * the same way `plugins/identity-auth.ts` reaches for its server helpers.
 */
const loadSegment = async (publicId: string, sdk: ReturnType<typeof useNadeshikoSdk>) => {
  if (!import.meta.server) return sdk.getSegment(publicId);

  const { cachedSegment } = await import('~~/server/utils/segmentCache');
  return cachedSegment(publicId, () => sdk.getSegment(publicId));
};

const fetchSentenceData = async () => {
  const sdk = useNadeshikoSdk();

  const segment = await loadSegment(id.value, sdk).catch((error: unknown) => {
    // A deleted or mistyped permalink is a genuine 404; anything else is our own
    // failure and must not be dressed up as "this sentence does not exist".
    if (error instanceof NadeshikoError && error.status === 404) return null;
    reportError('sentence:fetch-failed', error, { 'segment.publicId': id.value });
    throw error;
  });
  if (!segment) return null;

  const media = await sdk.getMedia(segment.mediaPublicId).catch((error: unknown) => {
    // The sentence itself resolved; a missing media only costs the page its title card.
    reportError('sentence:media-fetch-failed', error, { 'media.publicId': segment.mediaPublicId });
    return null;
  });

  return resolveSearchResponse({
    segments: [segment],
    includes: { media: media ? { [segment.mediaPublicId]: media } : {} },
    pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
  });
};

const { data: initialSentenceData, error: sentenceError } = await useAsyncData(
  `sentence-${id.value}`,
  () => fetchSentenceData(),
  { server: true, lazy: false },
);

// Returning `null` would render the permalink as an empty page at HTTP 200, which
// crawlers happily index and users read as "the site is broken".
if (sentenceError.value) {
  throw createError({ statusCode: 500, statusMessage: 'Failed to load sentence' });
}
if (!initialSentenceData.value) {
  throw createError({ statusCode: 404, statusMessage: 'Sentence Not Found' });
}

const initialStatsData = computed<SearchStatsResponse | null>(() => {
  const result = initialSentenceData.value?.results?.[0];
  if (!result) return null;
  return {
    media: [
      {
        mediaPublicId: result.media.publicId,
        matchCount: 1,
        episodeHits: [],
        nameRomaji: result.media.nameRomaji,
        nameEn: result.media.nameEn,
        nameJa: result.media.nameJa,
        category: result.media.category,
        airingFormat: result.media.airingFormat,
        slug: result.media.slug,
      },
    ],
    categories: [{ category: result.media.category === 'JDRAMA' ? 'JDRAMA' : 'ANIME', count: 1, realCount: 1 }],
  };
});

const metaTags = computed(() => {
  const defaultTitle = t('seo.sentence.title');
  const defaultDescription = t('seo.sentence.defaultDescription');

  const tags = buildDefaultMetaTags(defaultTitle, defaultDescription);

  const result = initialSentenceData.value?.results?.[0];

  if (result) {
    const sentenceTags = buildSentenceMetaTags(
      result,
      mediaName,
      (n) => t('seo.sentence.episode', { n }),
      (sentence, media) => t('seo.sentence.pageTitle', { sentence, media }),
    );
    tags.title = sentenceTags.title;
    tags.meta = sentenceTags.meta;
  }

  return tags;
});

useHead(metaTags);

/**
 * A sentence permalink is a page whose entire subject is one short video clip,
 * and it said so nowhere in its structured data. `VideoObject` is what makes it
 * eligible for Google's video results -- the surface these pages could plausibly
 * win, since they cannot out-rank a dictionary on the word itself.
 *
 * `uploadDate` is Google's one required property that this data does not
 * literally have: a segment carries no timestamp of its own. The media's first
 * airing date is the honest stand-in -- it IS when the footage was published --
 * and when a title has none the property is dropped rather than invented. The
 * markup stays valid either way; without it the page is simply not a rich-result
 * candidate, which is better than claiming a date that is not real.
 */
const videoSchema = computed(() => {
  const result = initialSentenceData.value?.results?.[0];
  if (!result?.segment.urls.videoUrl) return null;

  const { segment, media } = result;
  const durationSeconds = Math.max(0, (segment.endTimeMs - segment.startTimeMs) / 1000);

  return defineVideo({
    name: `${mediaName(media)} - ${t('seo.sentence.episode', { n: segment.episode })}`,
    description: segment.textJa.content,
    thumbnailUrl: segment.urls.imageUrl,
    contentUrl: segment.urls.videoUrl,
    // ISO 8601. Clips run a few seconds, so sub-second precision is most of the
    // value -- `PT3S` for a 3.4s clip is a 12% lie about a very short thing.
    duration: `PT${durationSeconds.toFixed(1)}S`,
    inLanguage: 'ja',
    ...(media.startDate ? { uploadDate: media.startDate } : {}),
  });
});

// A `computed`, not a plain arrow: the composable reaches for its reactive path
// only via `isRef`, and a bare function would be handed straight to unhead as
// the node list.
const breadcrumbItems = computed(() => {
  const items = [{ name: t('navbar.buttons.home'), item: localePath('/') }];
  const result = initialSentenceData.value?.results?.[0];

  if (result) {
    items.push({ name: t('seo.media.title'), item: localePath('/media') });
    items.push({
      name: mediaName(result.media),
      item: localePath(mediaBrowsePath(result.media)),
    });
  }

  return items;
});

/**
 * The visible (screen-reader) heading, which is the page's subject rather than
 * its `<title>`: the brand suffix belongs in the tab and the SERP, not in the
 * document outline.
 */
const headline = computed(() => {
  const result = initialSentenceData.value?.results?.[0];
  if (!result) return t('seo.sentence.title');
  return `「${result.segment.textJa.content}」 - ${mediaName(result.media)}`;
});

const schemaOrgNodes = computed(() => [
  defineWebPage({ '@type': 'ItemPage' }),
  defineBreadcrumb({ itemListElement: breadcrumbItems.value }),
  ...(videoSchema.value ? [videoSchema.value] : []),
]);

useSchemaOrg(schemaOrgNodes);

if (import.meta.client) {
  const result = initialSentenceData.value?.results?.[0];
  const posthog = usePostHog();
  posthog?.capture('shared_link_viewed', {
    segment_id: id.value,
    media_name: result ? mediaName(result.media) : undefined,
    referrer: document.referrer || undefined,
  });
}
</script>

<template>
    <div class="mx-auto">
            <div class="relative text-white">
                    <div class="nd-page">
                        <h1 class="sr-only">{{ headline }}</h1>
                        <div class="px-4 md:px-0">
                            <SearchBaseInputSegment />
                        </div>
                        <SearchContainer :initial-sentence-data="initialSentenceData" :initial-stats-data="initialStatsData" />
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
