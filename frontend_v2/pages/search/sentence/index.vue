<script setup>
const route = useRoute();

// Get UUID from route query
const uuid = computed(() => route.query.uuid);

// Function to fetch sentence data for meta tags
const fetchSentenceForMeta = async () => {
  if (!uuid.value) return null;

  try {
    const apiSearch = useApiSearch();
    const response = await apiSearch.getSentenceV1({
      uuid: uuid.value,
      limit: 1,
      extra: true
    });
    return response?.sentences?.[0] || null;
  } catch (error) {
    console.error('Error fetching sentence for meta tags:', error);
    return null;
  }
};

// Fetch sentence data if UUID is present
const { data: sentenceData } = await useAsyncData(
  `sentence-meta-${uuid.value}`,
  () => fetchSentenceForMeta(),
  {
    watch: [uuid],
    server: true,
    lazy: false
  }
);

// Compute meta tags
const metaTags = computed(() => {
  const tags = {
    title: 'Nadeshiko',
    meta: [
      { name: 'description', content: 'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!' },
      { property: 'og:title', content: 'Nadeshiko' },
      { property: 'og:description', content: 'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ]
  };

  if (sentenceData.value) {
    const sentence = sentenceData.value;
    const mediaType = sentence.basic_info.season === 0
      ? 'Movie'
      : `Season ${sentence.basic_info.season}, Episode ${sentence.basic_info.episode}`;

    const title = `${sentence.basic_info.name_anime_en} | Nadeshiko`;
    const description = `"${sentence.segment_info.content_jp}" - From ${sentence.basic_info.name_anime_en} (${mediaType})`;

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: sentence.media_info.path_image + '?width=1200&height=630' },
      { property: 'og:site_name', content: `Nadeshiko - ${sentence.basic_info.name_anime_en}` },
      { property: 'og:locale', content: 'ja_JP' },
      { property: 'og:locale:alternate', content: 'es_ES' },
      { property: 'og:locale:alternate', content: 'en_US' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: sentence.media_info.path_image + '?width=1200&height=630' },
    ];

    // Add video tags if available
    if (sentence.media_info.path_video) {
      const mp4Url = sentence.media_info.path_video;
      tags.meta.push(
        { property: 'og:video', content: mp4Url },
        { property: 'og:video:type', content: 'video/mp4' },
        { property: 'og:video:width', content: '1280' },
        { property: 'og:video:height', content: '720' },
        { name: 'twitter:card', content: 'player' },
        { name: 'twitter:player', content: `https://nadeshiko.co/embed/player?url=${encodeURIComponent(mp4Url)}` },
        { name: 'twitter:player:width', content: '1280' },
        { name: 'twitter:player:height', content: '720' }
      );
    }
  }

  return tags;
});

// Set meta tags
useHead(metaTags);
</script>

<template>
    <NuxtLayout>
        <div class="mx-auto">
            <div class="relative text-white">
                <div class="pt-2">
                    <div class="md:max-w-[92%] mx-auto">
                        <SearchBaseInputSegment />
                        <SearchContainer />
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