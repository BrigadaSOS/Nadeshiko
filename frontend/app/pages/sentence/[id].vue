<script setup lang="ts">
import { buildSentenceMetaTags, socialTitle } from '~/utils/metaTags';
import { resolveSearchResponse } from '~/utils/resolvers';
import type { SearchStatsResponse } from '~/types/search';

const route = useRoute();
const { mediaName } = useMediaName();

const id = computed(() => String(route.params.id));

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const { data: segment } = await sdk.getSegment({ path: { segmentPublicId: id.value } });
    if (!segment) return null;
    const { data: media } = await sdk.getMedia({ path: { mediaPublicId: segment.mediaPublicId } });
    return resolveSearchResponse({
      segments: [segment],
      includes: { media: media ? { [segment.mediaPublicId]: media } : {} },
      pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
    });
  } catch {
    return null;
  }
};

const { data: initialSentenceData } = await useAsyncData(`sentence-${id.value}`, () => fetchSentenceData(), {
  server: true,
  lazy: false,
});

const initialStatsData = computed<SearchStatsResponse | null>(() => {
  const result = initialSentenceData.value?.results?.[0];
  if (!result) return null;
  return {
    media: [
      {
        mediaPublicId: result.media.mediaPublicId,
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
    categories: [{ category: result.media.category === 'JDRAMA' ? 'JDRAMA' : 'ANIME', count: 1 }],
  };
});

const metaTags = computed(() => {
  const defaultDescription =
    'Search over 1 million Japanese sentences with English and Spanish translations from a wide variety of anime and J-dramas.';

  const tags: { title: string; meta: Array<{ name?: string; property?: string; content: string }> } = {
    title: 'Sentence',
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: socialTitle('Sentence') },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: socialTitle('Sentence') },
      { name: 'twitter:description', content: defaultDescription },
    ],
  };

  const result = initialSentenceData.value?.results?.[0];

  if (result) {
    const sentenceTags = buildSentenceMetaTags(result, mediaName);
    tags.title = sentenceTags.title;
    tags.meta = sentenceTags.meta;
  }

  return tags;
});

useHead(metaTags);

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
                <div class="pt-2">
                    <div class="md:max-w-[70%] mx-auto">
                        <h1 class="sr-only">{{ metaTags.title }}</h1>
                        <SearchBaseInputSegment />
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
