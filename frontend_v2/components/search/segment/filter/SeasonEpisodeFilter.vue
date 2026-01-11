<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const props = defineProps({
    seasonWithEpisodeHits: {
        type: Object,
        default: () => ({})
    },
    selectedMediaId: {
        type: [Number, String],
        default: null
    }
});

// Computed: Parse URL parameters
const selectedSeasonIds = computed(() => {
    if (!route.query.season) return new Set();
    const seasons = route.query.season.split(',')
        .map(Number)
        .filter(n => !isNaN(n));
    return new Set(seasons);
});

const selectedEpisodeId = computed(() => {
    if (!route.query.episode) return null;
    const episodeId = Number(route.query.episode);
    return isNaN(episodeId) ? null : episodeId;
});

// Computed: Build seasons list
const seasonsList = computed(() => {
    const seasons = [];

    for (const [seasonNum, episodes] of Object.entries(props.seasonWithEpisodeHits)) {
        const seasonNumInt = Number(seasonNum);
        const episodeList = Object.entries(episodes).map(([epNum, count]) => ({
            episode: Number(epNum),
            count
        }));

        // Calculate season total
        const seasonTotal = Object.values(episodes).reduce((a, b) => a + b, 0);

        seasons.push({
            season: seasonNumInt,
            episodes: episodeList,
            totalCount: seasonTotal
        });
    }

    // Sort by season number
    return seasons.sort((a, b) => a.season - b.season);
});

// Computed: Seasons to expand (manually selected + season with selected episode)
const expandedSeasons = computed(() => {
    const expanded = new Set(selectedSeasonIds.value);

    // Auto-expand season that contains the selected episode
    if (selectedEpisodeId.value !== null) {
        for (const season of seasonsList.value) {
            const hasSelectedEpisode = season.episodes.some(ep =>
                ep.episode === selectedEpisodeId.value
            );
            if (hasSelectedEpisode) {
                expanded.add(season.season);
            }
        }
    }

    return expanded;
});

// Methods
const toggleSeason = (seasonId) => {
    const currentSeasons = selectedSeasonIds.value;
    const newSeasons = new Set(currentSeasons);

    if (newSeasons.has(seasonId)) {
        newSeasons.delete(seasonId);
    } else {
        newSeasons.add(seasonId);
    }

    // Clear episode filter when selecting/deselecting seasons
    updateUrlParams(Array.from(newSeasons), null);
};

const toggleEpisode = (episodeId) => {
    // Single selection: toggle off if clicking the same episode, otherwise select the new episode
    const newEpisodeId = selectedEpisodeId.value === episodeId ? null : episodeId;
    updateUrlParams(Array.from(selectedSeasonIds.value), newEpisodeId);
};

const updateUrlParams = (seasons, episode) => {
    const query = { ...route.query };

    if (seasons && seasons.length > 0) {
        query.season = seasons.join(',');
    } else {
        delete query.season;
    }

    if (episode !== null) {
        query.episode = episode;
    } else {
        delete query.episode;
    }

    router.push({ query });
};

const clearFilters = () => {
    const query = { ...route.query };
    delete query.season;
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

            <!-- Seasons List -->
            <div class="overflow-auto snap-y max-h-[14rem]">
                <template v-if="seasonsList.length > 0">
                    <div v-for="season in seasonsList" :key="season.season">
                        <!-- Season Header -->
                        <button @click="toggleSeason(season.season)"
                            :class="{ 'bg-sgrayhover': selectedSeasonIds.has(season.season) }"
                            class="flex truncate border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5"
                            :title="`${$t('searchpage.main.labels.season')} ${season.season}: ${season.totalCount}`">
                            <span class="flex items-center gap-2 truncate max-w-[80%] overflow-hidden text-ellipsis">
                                <span class="text-xs shrink-0">
                                    {{ expandedSeasons.has(season.season) ? '▼' : '▶' }}
                                </span>
                                <span>
                                    {{ $t('searchpage.main.labels.season') }} {{ season.season }}
                                </span>
                            </span>
                            <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
                                {{ season.totalCount }}
                            </span>
                        </button>

                        <!-- Episodes List (shown if season expanded) - ALWAYS shows all episodes -->
                        <div v-if="expandedSeasons.has(season.season)">
                            <button
                                v-for="episode in season.episodes"
                                :key="episode.episode"
                                @click="toggleEpisode(episode.episode)"
                                :class="{ 'bg-sgrayhover': selectedEpisodeId === episode.episode }"
                                class="flex truncate border duration-300 items-center justify-between w-full px-8 py-2 hover:bg-sgrayhover text-xs xxl:text-base xxm:text-2xl text-left dark:border-white/5"
                                :title="`${$t('searchpage.main.labels.episode')} ${episode.episode}: ${episode.count}`">
                                <span class="truncate max-w-[80%] overflow-hidden text-ellipsis">
                                    {{ $t('searchpage.main.labels.episode') }} {{ episode.episode }}
                                </span>
                                <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
                                    {{ episode.count }}
                                </span>
                            </button>
                            <div v-if="season.episodes.length === 0"
                                class="px-8 py-2 text-xs text-gray-400 dark:text-gray-500">
                                {{ $t('seasonEpisodeFilter.noEpisodes') }}
                            </div>
                        </div>
                    </div>
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
