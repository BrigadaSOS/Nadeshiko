<script setup>
const route = useRoute();
const { mediaName } = useMediaName();

const uuid = computed(() => String(route.params.uuid));

const fetchSentenceData = async () => {
  try {
    const apiSearch = useApiSearch();
    return await apiSearch.searchSegments({
      limit: 20,
      uuid: uuid.value,
    });
  } catch (error) {
    console.error('Error fetching sentence data:', error);
    return null;
  }
};

const fetchStatsData = async () => {
  try {
    const apiSearch = useApiSearch();
    return await apiSearch.getSearchStats({});
  } catch (error) {
    console.error('Error fetching search stats:', error);
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
    const mediaInfo = `Episode ${result.segment.episodeNumber}`;
    const title = `${mediaName(result.media)} | Nadeshiko`;
    const description = `「${result.segment.textJa.content}」\n${mediaInfo}`;

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: result.urls.imageUrl },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: result.urls.imageUrl },
    ];

    if (result.urls.videoUrl) {
      tags.meta.push(
        { property: 'og:video', content: result.urls.videoUrl },
        { property: 'og:video:type', content: 'video/mp4' },
        { property: 'og:video:width', content: '1280' },
        { property: 'og:video:height', content: '720' },
      );
    }
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
