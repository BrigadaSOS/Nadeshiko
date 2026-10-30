<script setup lang="ts">
import { useDocumentVisibility, useTimeoutFn } from '@vueuse/core';
import { ENGAGED_VIEW_DWELL_MS, createEngagedViewGate } from '~/utils/engagedView';
import { buildDefaultMetaTags, buildSentenceMetaTags } from '~/utils/metaTags';
import { mediaBrowsePath } from '~/utils/routes';
import { resolveSearchResponse } from '~/utils/resolvers';
import { apiErrorStatus, isMissing } from '~/utils/apiError';
import { reportError } from '~/utils/reportError';
import type { FetchOutcome } from '~/composables/useSearchFetch';
import type { SearchResponse, SearchStatsResponse } from '~/types/search';

const { t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const { mediaName } = useMediaName();

const id = computed(() => String(route.params.id));

// Shared SSR cache collapses concurrent permalink loads into one backend call.
// Dynamic import keeps the process-local server cache out of the client bundle;
// browsers continue using the SDK and their own HTTP cache.
const loadSegment = async (publicId: string, sdk: ReturnType<typeof useNadeshikoSdk>) => {
  if (!import.meta.server) return sdk.getSegment(publicId);

  const { cachedSegment } = await import('~~/server/utils/segmentCache');
  return cachedSegment(publicId, () => sdk.getSegment(publicId));
};

// Many sentences share a title; cache media lookups too, not just the segment.
const loadMedia = async (publicId: string, sdk: ReturnType<typeof useNadeshikoSdk>) => {
  if (!import.meta.server) return sdk.getMedia(publicId);

  const { cachedMedia } = await import('~~/server/utils/mediaCache');
  return cachedMedia(publicId, () => sdk.getMedia(publicId));
};

const fetchSentenceData = async () => {
  const sdk = useNadeshikoSdk();

  const segment = await loadSegment(id.value, sdk).catch((error: unknown) => {
    // Match status across the SSR boundary, not error class identity. Invalid IDs return
    // 400 before lookup; both 400 and 404 mean a wrong URL, while other failures propagate.
    if (isMissing(apiErrorStatus(error))) return null;
    reportError('sentence:fetch-failed', error, { 'segment.publicId': id.value });
    throw error;
  });
  if (!segment) return null;

  const media = await loadMedia(segment.mediaPublicId, sdk).catch((error: unknown) => {
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

// Do not turn failed/missing permalinks into empty HTTP 200 pages.
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

// SearchContainer takes outcomes, not bare data. Without one it treats the page as unprimed and runs
// its own corpus search on mount, which on /sentence/ has no query and replaces the shared sentence.
const initialSentenceOutcome = computed<FetchOutcome<SearchResponse> | null>(() =>
  initialSentenceData.value ? { status: 'ok', data: initialSentenceData.value } : null,
);
const initialStatsOutcome = computed<FetchOutcome<SearchStatsResponse> | null>(() =>
  initialStatsData.value ? { status: 'ok', data: initialStatsData.value } : null,
);

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

// VideoObject enables video results. Segments have no timestamp, so use the media's
// first airing date for uploadDate; omit it when unknown rather than inventing one,
// even though that makes the page ineligible for a video rich result.
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
    // Preserve tenths of a second in the ISO 8601 duration of these short clips.
    duration: `PT${durationSeconds.toFixed(1)}S`,
    inLanguage: 'ja',
    ...(media.startDate ? { uploadDate: media.startDate } : {}),
  });
});

// The composable checks isRef; a plain function would be passed to Unhead as the node list.
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

// Keep the brand suffix in <title>, not in the screen-reader document outline.
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

// Keep shared_link_viewed on every load for historical comparisons and countable bot traffic.
// Add shared_link_read after foreground dwell rather than dropping unengaged views at capture.
// This keeps filtering reversible at query time. User-agent/fingerprint heuristics miss
// scrapers that execute JS and also misclassify readers; foreground dwell separates attention.
if (import.meta.client) {
  const posthog = usePostHog();

  const viewProperties = () => {
    const result = initialSentenceData.value?.results?.[0];
    return {
      segment_id: id.value,
      media_name: result ? mediaName(result.media) : undefined,
      referrer: document.referrer || undefined,
    };
  };

  posthog?.capture('shared_link_viewed', viewProperties());

  const visibility = useDocumentVisibility();
  const gate = createEngagedViewGate(ENGAGED_VIEW_DWELL_MS, visibility.value === 'visible', Date.now());

  // A reactive delay resumes interrupted dwell for the remaining time.
  const remainingMs = ref(ENGAGED_VIEW_DWELL_MS);

  const { start, stop } = useTimeoutFn(
    () => {
      if (!gate.claim(Date.now())) return;
      posthog?.capture('shared_link_read', viewProperties());
    },
    remainingMs,
    // Armed below, so a tab that starts in the background schedules nothing.
    { immediate: false },
  );

  const arm = (now: number) => {
    remainingMs.value = Math.max(0, ENGAGED_VIEW_DWELL_MS - gate.elapsed(now));
    start();
  };

  // Pause dwell in background tabs and resume the remainder when visible;
  // opening a Discord link in the background must not count as reading it.
  watch(visibility, (state) => {
    const now = Date.now();
    const visible = state === 'visible';

    gate.setVisible(visible, now);
    if (visible) arm(now);
    else stop();
  });

  onMounted(() => {
    if (visibility.value === 'visible') arm(Date.now());
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
                        <SearchContainer :initial-sentence-outcome="initialSentenceOutcome" :initial-stats-outcome="initialStatsOutcome" />
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
