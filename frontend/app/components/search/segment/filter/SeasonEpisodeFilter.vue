<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const props = defineProps({
  seasonWithEpisodeHits: {
    type: Object,
    default: () => ({}),
  },
  selectedMediaId: {
    type: [Number, String],
    default: null,
  },
});

// Computed: Parse URL parameters
const selectedEpisodeId = computed(() => {
  if (!route.query.episode) return null;
  const episodeId = Number(route.query.episode);
  return Number.isNaN(episodeId) ? null : episodeId;
});

// Computed: Build episodes list (from season 0 which contains all episodes)
const episodesList = computed(() => {
  // The backend now returns { 0: episodesWithResults }
  const episodesData = props.seasonWithEpisodeHits?.['0'] || {};

  return Object.entries(episodesData)
    .map(([epNum, count]) => ({
      episode: Number(epNum),
      count,
    }))
    .sort((a, b) => a.episode - b.episode);
});

// Methods
const toggleEpisode = (episodeId) => {
  // Single selection: toggle off if clicking the same episode, otherwise select the new episode
  const newEpisodeId = selectedEpisodeId.value === episodeId ? null : episodeId;
  updateUrlParams(newEpisodeId);
};

const updateUrlParams = (episode) => {
  const query = { ...route.query };

  if (episode !== null) {
    query.episode = episode;
  } else {
    delete query.episode;
  }

  router.push({ query });
};

const clearFilters = () => {
  const query = { ...route.query };
  delete query.episode;
  router.push({ query });
};
</script>

<template>
    <div class="relative mx-auto mt-4">
        <ul
            class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 rounded-lg dark:bg-button-primary-main border dark:text-white">
            <!-- Header -->
            <div class="flex items-center w-full px-4 py-2 text-center rounded-t-lg rounded-l-lg">
                <span class="font-medium text-sm flex-1 text-center">{{ $t('seasonEpisodeFilter.title') }}</span>
                <button
                    @click="clearFilters"
                    class="text-xs text-gray-400 hover:text-gray-200 dark:hover:text-white absolute right-4">
                    {{ $t('seasonEpisodeFilter.clear') }}
                </button>
            </div>

            <!-- Episodes List -->
            <div class="overflow-auto snap-y max-h-[14rem]">
                <template v-if="episodesList.length > 0">
                    <button
                        v-for="episode in episodesList"
                        :key="episode.episode"
                        @click="toggleEpisode(episode.episode)"
                        :class="{ 'bg-sgrayhover': selectedEpisodeId === episode.episode }"
                        class="flex truncate border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5"
                        :title="`${$t('searchpage.main.labels.episode')} ${episode.episode}: ${episode.count}`">
                        <span class="truncate max-w-[80%] overflow-hidden text-ellipsis">
                            {{ $t('searchpage.main.labels.episode') }} {{ episode.episode }}
                        </span>
                        <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
                            {{ episode.count }}
                        </span>
                    </button>
                </template>
                <div v-else class="px-4 py-2 text-xs text-gray-400 dark:text-gray-500">
                    {{ $t('seasonEpisodeFilter.noEpisodes') }}
                </div>
            </div>

            <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600">
            </div>
        </ul>
    </div>
</template>
