<script setup lang="ts">
import { buildSentenceMetaTags } from '~/utils/metaTags';
import { resolveSearchResponse } from '~/utils/resolvers';
import type { SearchStatsResponse } from '~/types/search';

const route = useRoute();
const { mediaName } = useMediaName();

const id = computed(() => String(route.params.id));

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const { data: segment } = await sdk.getSegmentByUuid({ path: { uuid: id.value } });
    if (!segment) return null;
    const { data: media } = await sdk.getMedia({ path: { id: segment.mediaId } });
    return resolveSearchResponse({
      segments: [segment],
      includes: { media: media ? { [String(segment.mediaId)]: media } : {} },
      pagination: { hasMore: false, cursor: '', estimatedTotalHits: 1, estimatedTotalHitsRelation: 'EXACT' },
    });
  } catch {
    return null;
  }
};

const { data: initialSentenceData } = await useAsyncData(
  `sentence-${id.value}`,
  () => fetchSentenceData(),
  { server: true, lazy: false },
);

const initialStatsData = computed<SearchStatsResponse | null>(() => {
  const result = initialSentenceData.value?.results?.[0];
  if (!result) return null;
  return {
    media: [{
      mediaId: result.media.id,
      matchCount: 1,
      episodeHits: {},
      nameRomaji: result.media.nameRomaji,
      nameEn: result.media.nameEn,
      nameJa: result.media.nameJa,
      category: result.media.category,
    }],
    categories: [{ category: result.media.category === 'JDRAMA' ? 'JDRAMA' : 'ANIME', count: 1 }],
  };
});

const metaTags = computed(() => {
  const defaultDescription =
    'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!';

  const tags = {
    title: 'Nadeshiko',
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: 'Nadeshiko' },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
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
</script>

<template>
    <NuxtLayout>
        <div class="mx-auto">
            <div class="relative text-white">
                <div class="pt-2">
                    <div class="md:max-w-[92%] mx-auto">
                        <SearchBaseInputSegment />
                        <SearchContainer :initial-sentence-data="initialSentenceData" :initial-stats-data="initialStatsData" />
                    </div>
                </div>
            </div>
        </div>
    </NuxtLayout>
</template>
<style>
em {
    text-decoration: underline;
    text-underline-offset: 0.2em;
    font-style: normal;
    color: #df848d;
}
</style>
