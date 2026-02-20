<script setup>
import { buildSentenceMetaTags } from '~/utils/metaTags';
import { resolveSearchResponse, resolveStatsResponse } from '~/utils/resolvers';

const route = useRoute();
const { mediaName } = useMediaName();
const { contentRating } = useContentRating();

const uuid = computed(() => String(route.params.uuid));

const fetchSentenceData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const response = await sdk.search({
      body: {
        uuid: uuid.value,
        filters: { contentRating: contentRating.value },
        include: ['media'],
      },
    });
    return response.data ? resolveSearchResponse(response.data) : null;
  } catch {
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const sdk = useNadeshikoSdk();
    const response = await sdk.getSearchStats({
      body: {
        filters: { contentRating: contentRating.value },
        include: ['media'],
      },
    });
    return response.data ? resolveStatsResponse(response.data) : null;
  } catch {
    return null;
  }
};

const { data: initialSentenceData } = await useAsyncData(
  () => `sentence-${uuid.value}`,
  () => fetchSentenceData(),
  { server: true, lazy: false },
);

const { data: initialStatsData } = await useAsyncData(
  () => `sentence-stats-${uuid.value}`,
  () => fetchStatsData(),
  { server: true, lazy: false },
);

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
