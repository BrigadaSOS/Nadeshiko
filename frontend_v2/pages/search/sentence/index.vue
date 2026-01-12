<script setup>
const { t } = useI18n();
const route = useRoute();

const categoryMapping = {
  'all': 0,
  'anime': 1,
  'liveaction': 3,
  'audiobook': 4
};

const fetchSearchData = async () => {
  try {
    const apiSearch = useApiSearch();
    const body = {
      limit: 20,
      extra: true
    };

    if (route.query.query) {
      body.query = route.query.query;
    }

    if (route.query.uuid) {
      body.uuid = route.query.uuid;
    }

    const categoryValue = categoryMapping[route.query.category] ?? 0;
    if (categoryValue !== 0) {
      body.category = [categoryValue];
    }

    if (route.query.media) {
      body.anime_id = route.query.media;
    }

    if (route.query.season) {
      body.season = route.query.season.split(',').map(Number);
    }

    if (route.query.episode) {
      body.episode = [Number(route.query.episode)];
    }

    if (route.query.sort && route.query.sort !== 'none') {
      body.content_sort = route.query.sort;
    }

    return await apiSearch.getSentenceV1(body);
  } catch (error) {
    console.error('Error fetching search data:', error);
    return null;
  }
};

const cacheKey = computed(() => {
  const params = [
    route.query.query,
    route.query.uuid,
    route.query.category,
    route.query.media,
    route.query.season,
    route.query.episode,
    route.query.sort
  ].filter(Boolean).join('-');
  return `search-${params || 'default'}`;
});

const { data: initialSearchData } = await useAsyncData(
  cacheKey.value,
  () => fetchSearchData(),
  {
    server: true,
    lazy: false
  }
);

const metaTags = computed(() => {
  const defaultDescription = 'Online sentence search engine designed to display content from a wide variety of media including anime, J-dramas, films and more!';

  const tags = {
    title: 'Nadeshiko',
    meta: [
      { name: 'description', content: defaultDescription },
      { property: 'og:title', content: 'Nadeshiko' },
      { property: 'og:description', content: defaultDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ]
  };

  const sentence = initialSearchData.value?.sentences?.[0];
  if (route.query.uuid && sentence) {
    const mediaInfo = sentence.basic_info.season === 0
      ? 'Movie'
      : `Season ${sentence.basic_info.season}, Episode ${sentence.basic_info.episode}`;

    const title = `${sentence.basic_info.name_anime_en} | Nadeshiko`;
    const description = `「${sentence.segment_info.content_jp}」\n${mediaInfo}`;

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: sentence.media_info.path_image + '?width=1200&height=630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: sentence.media_info.path_image + '?width=1200&height=630' },
    ];

    if (sentence.media_info.path_video) {
      tags.meta.push(
        { property: 'og:video', content: sentence.media_info.path_video },
        { property: 'og:video:type', content: 'video/mp4' },
        { property: 'og:video:width', content: '1280' },
        { property: 'og:video:height', content: '720' }
      );
    }
  } else if (route.query.query) {
    const stats = initialSearchData.value?.categoryStatistics;
    const totalResults = stats?.reduce((sum, s) => sum + s.count, 0) || 0;

    const title = `Search: ${route.query.query} | Nadeshiko`;
    let description = totalResults > 0
      ? `${totalResults.toLocaleString()} results found`
      : 'Search for Japanese sentences';

    if (stats && stats.length > 0) {
      const categoryNames = { 1: 'anime', 3: 'live-action', 4: 'audiobook' };
      const order = [1, 3, 4];
      const breakdown = order
        .map(cat => stats.find(s => s.category === cat))
        .filter(Boolean)
        .filter(s => s.count > 0)
        .map(s => `${categoryNames[s.category]}: ${s.count.toLocaleString()}`)
        .join(', ');
      if (breakdown) {
        description += `\n(${breakdown})`;
      }
    }

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ];
  } else if (route.query.media && initialSearchData.value?.sentences?.length > 0) {
    const firstSentence = initialSearchData.value.sentences[0];
    const animeName = firstSentence.basic_info.name_anime_en;
    const animeId = firstSentence.basic_info.anime_id;

    const animeStats = initialSearchData.value?.statistics?.find(s => s.anime_id === Number(animeId));

    const filterSeason = route.query.season ? route.query.season.split(',').map(Number) : null;
    const filterEpisode = route.query.episode ? Number(route.query.episode) : null;

    let totalResults = animeStats?.amount_sentences_found || 0;
    const seasonData = animeStats?.season_with_episode_hits;

    if (seasonData && filterSeason && filterSeason.length === 1) {
      const episodes = seasonData[filterSeason[0]] || {};
      if (filterEpisode) {
        totalResults = episodes[filterEpisode] || 0;
      } else {
        totalResults = Object.values(episodes).reduce((sum, count) => sum + count, 0);
      }
    }

    const title = `${animeName} | Nadeshiko`;
    let description = `${totalResults.toLocaleString()} sentences`;

    if (seasonData && Object.keys(seasonData).length > 0) {
      const seasons = Object.keys(seasonData).map(Number).sort((a, b) => a - b);
      if (seasons.length === 1 && seasons[0] === 0) {
        description += '\nMovie';
      } else {
        description += `\n${seasons.length} season${seasons.length > 1 ? 's' : ''}`;

        if (filterSeason && filterSeason.length === 1) {
          const episodes = seasonData[filterSeason[0]] || {};
          const episodeCount = Object.keys(episodes).length;
          if (filterEpisode) {
            description = `${totalResults.toLocaleString()} sentences\nSeason ${filterSeason[0]}, Episode ${filterEpisode}`;
          } else {
            description += `\nSeason ${filterSeason[0]}: ${episodeCount} episode${episodeCount > 1 ? 's' : ''}`;
          }
        } else if (!filterSeason) {
          const episodeCount = Object.values(seasonData).reduce((sum, s) => sum + Object.keys(s).length, 0);
          description += `, ${episodeCount} episode${episodeCount > 1 ? 's' : ''}`;
        }
      }
    }

    const thumbnail = firstSentence.basic_info?.cover || firstSentence.media_info.path_image;

    tags.title = title;
    tags.meta = [
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: thumbnail + '?width=1200&height=630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: thumbnail + '?width=1200&height=630' },
    ];
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
                        <SearchContainer :initial-data="initialSearchData" />
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
