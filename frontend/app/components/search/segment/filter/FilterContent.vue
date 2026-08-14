<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiChevronLeft } from '@mdi/js';
import { useI18n } from 'vue-i18n';
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { compareMediaRows } from '~/utils/mediaFilterSort';
import type { ResolvedMediaStats, SearchSidebarData } from '~/types/search';

/** One row of the media filter list; the leading "all" row carries a null id. */
type MediaFilterRow = {
  mediaPublicId: string | null;
  /** Absent on the leading "all" row, and on any payload predating slug support. */
  slug?: string | null;
  displayName: string;
  displayNameLower: string;
  matchCount: number;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

const { t } = useI18n();
const route = useRoute();
const { setQuery } = useQuerySync();
const { selectMedia } = useMediaScope();
const { mediaName: getMediaName } = useMediaName();
// Only the ordering is needed here; the star itself owns toggling.
const { favoriteMediaIds } = useFavoriteMedia();
const { inferredRank } = useFamiliarMedia();
const props = defineProps<{
  searchData?: SearchSidebarData | null;
  categorySelected?: string | null;
  /**
   * The title currently in scope, when the ROUTE names it rather than `?media=`
   * -- i.e. on `/media/<slug>`. Without it this panel reads the query string,
   * finds nothing, and shows the title list as though nothing were selected on
   * the very page that is scoped to one title.
   */
  activeMediaId?: string | null;
}>();
// Raised when a row is picked to filter by, so the mobile drawer -- which
// covers the very list the pick just changed -- can get out of the way. Backing
// out of the episode level and Clear stay silent: those are the reader working
// the panel, not asking to see results.
const emit = defineEmits<{ applied: [] }>();
const mediaStatistics = ref<ResolvedMediaStats[]>([]);
const querySearchMedia = ref('');
const debouncedQuerySearchMedia = ref('');
const categorySelected = ref<string>(props.categorySelected ?? 'all');
const categoryApiMapping = CATEGORY_API_MAPPING;

// Cache translated strings outside computed to avoid repeated lookups
const allLabel = computed(() => t('searchpage.main.labels.all'));

// Each keystroke restarts the timer, so the list only re-filters 300ms after
// the reader stops typing. `useTimeoutFn` cancels it on unmount for us.
const { start: scheduleFilter } = useTimeoutFn(
  (value: string) => {
    debouncedQuerySearchMedia.value = value.toLowerCase();
  },
  300,
  { immediate: false },
);

watch(querySearchMedia, (newValue) => scheduleFilter(newValue), { immediate: true });

watch(
  () => props.searchData,
  (newData) => {
    if (newData?.media) {
      mediaStatistics.value = newData.media;
    } else {
      mediaStatistics.value = [];
    }
  },
  { immediate: true },
);

watch(
  () => props.categorySelected,
  (newCategory) => {
    if (newCategory !== null && newCategory !== undefined) {
      categorySelected.value = newCategory;
    } else {
      categorySelected.value = 'all';
    }
  },
  { immediate: true },
);

const normalizedStatistics = computed(() => {
  return mediaStatistics.value.map((item) => ({
    ...item,
    displayName: getMediaName(item),
    displayNameLower: getMediaName(item).toLowerCase(),
    nameEnLower: item?.nameEn?.toLowerCase() || '',
    nameJaLower: item?.nameJa?.toLowerCase() || '',
    nameRomajiLower: item?.nameRomaji?.toLowerCase() || '',
  }));
});

const filteredMedia = computed<MediaFilterRow[]>(() => {
  const selectedCategory = categoryApiMapping[categorySelected.value];
  const totalCount = normalizedStatistics.value
    .filter((item) => categorySelected.value === 'all' || item.category === selectedCategory)
    .reduce((a, b) => a + (b.matchCount ?? 0), 0);

  const filteredItems = normalizedStatistics.value.filter((item) => {
    const categoryFilter = categorySelected.value === 'all' || item.category === selectedCategory;
    const nameFilterEnglish = item.nameEnLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterJapanese = item.nameJaLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterRomaji = item.nameRomajiLower.includes(debouncedQuerySearchMedia.value);

    return categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji);
  });

  const allOption = {
    mediaPublicId: null,
    displayName: allLabel.value,
    displayNameLower: allLabel.value.toLowerCase(),
    matchCount: totalCount,
  };

  if (filteredItems.length === 0) {
    return [allOption];
  }

  // Starred first, then what the reader studies, then the rest alphabetically.
  // With neither -- a signed-out reader, or one who has starred nothing and has
  // no tally -- this is byte-for-byte the alphabetical order the filter has
  // always had.
  const sortedItems = filteredItems.sort((a, b) => compareMediaRows(a, b, favoriteMediaIds.value, inferredRank.value));

  // Prepended after the sort so "All" is index 0 whatever the tiers did.
  return [allOption, ...sortedItems];
});

const selectedMediaId = computed(() => {
  if (props.activeMediaId) return props.activeMediaId;
  return route.query.media ? String(route.query.media) : null;
});

const selectedStat = computed(
  () => normalizedStatistics.value.find((item) => item.mediaPublicId === selectedMediaId.value) ?? null,
);

// Movies have nothing below the title, so picking one stays on the title list
// rather than drilling into an episode level that would always be empty.
const hasEpisodeLevel = computed(() => !!selectedStat.value && selectedStat.value.airingFormat !== 'MOVIE');

/** Which half of the drill-down is on screen. Derived from the URL, never stored. */
const level = computed<'titles' | 'episodes'>(() => (hasEpisodeLevel.value ? 'episodes' : 'titles'));

const selectedEpisode = computed(() => {
  if (!route.query.episode) return null;
  const episode = Number(route.query.episode);
  return Number.isNaN(episode) ? null : episode;
});

const episodesList = computed(() => {
  return [...(selectedStat.value?.episodeHits ?? [])]
    .map((entry) => ({ episode: entry.episode, count: entry.hitCount }))
    .sort((a, b) => a.episode - b.episode);
});

const filterAnime = (mediaPublicId: string | null, _animeName: string, slug?: string | null) => {
  // Where this lands depends on whether a word is being searched -- see
  // `useMediaScope`, which also owns dropping the episode along with the title.
  selectMedia(mediaPublicId, slug);
  emit('applied');
};

/** Back out of the episode level: drops the title and the episode under it. */
const backToTitles = () => {
  selectMedia(null);
};

const toggleEpisode = (episode: number) => {
  const next = selectedEpisode.value === episode ? null : episode;
  setQuery({ episode: next === null ? null : String(next) }, { scroll: true });
  emit('applied');
};

// Only the title level offers Clear; the episode level clears by backing out,
// or by clicking the selected episode again.
const clearFilters = () => {
  selectMedia(null);
};

/**
 * Hand the keyboard to the level that just arrived.
 *
 * Drilling in destroys the row that was activated, and with it the focus that
 * was on it -- the browser drops focus to `<body>`, which puts a keyboard
 * reader back at the top of the document and makes them tab the whole page to
 * reach the list they just opened. Going in lands on the back row, coming out
 * lands on the title that was drilled into.
 *
 * Only when the focus was inside this panel to begin with: the level also
 * changes when a result card's media link sets `?media=`, and stealing the
 * keyboard into the sidebar then would be worse than doing nothing.
 */
const panel = ref<{ $el?: HTMLElement } | null>(null);
const drilledFrom = ref<string | null>(null);
const pendingFocus = ref<string | null>(null);

watch(level, (next) => {
  const root = panel.value?.$el;
  const cameFromPanel = !!root && !!document.activeElement && root.contains(document.activeElement);

  if (next === 'episodes') drilledFrom.value = selectedMediaId.value;
  if (!cameFromPanel) return;

  pendingFocus.value =
    next === 'episodes'
      ? '[data-testid="media-filter-back"]'
      : `[data-row-id="${CSS.escape(drilledFrom.value ?? '')}"] button`;
});

/**
 * Applied when the swap finishes rather than on the next tick: the list crosses
 * over with `mode="out-in"`, so the level being arrived at does not exist yet
 * while the outgoing one is still leaving.
 */
const applyPendingFocus = () => {
  const selector = pendingFocus.value;
  pendingFocus.value = null;
  if (!selector) return;
  panel.value?.$el?.querySelector<HTMLElement>(selector)?.focus();
};
</script>

<template>
    <SearchSegmentFilterPanelShell
        ref="panel"
        :title="level === 'episodes' ? $t('episodeFilter.title') : $t('searchpage.main.labels.contentList')"
        :action-label="level === 'titles' ? $t('episodeFilter.clear') : undefined"
        @action="clearFilters">

        <!-- Episode level: the header IS the way back, and doubles as the
             reminder of which title you drilled into. -->
        <template v-if="level === 'episodes'" #header>
            <button
                type="button"
                :aria-label="$t('filterContent.backToTitles')"
                :title="selectedStat?.displayName"
                data-testid="media-filter-back"
                class="group flex flex-1 min-w-0 items-center gap-1 text-left"
                @click="backToTitles">
                <UiBaseIcon :path="mdiChevronLeft" size="18"
                    class="shrink-0 text-white/60 transition-transform duration-200 group-hover:-translate-x-0.5" />
                <span class="flex-1 min-w-0 truncate text-sm font-medium">{{ selectedStat?.displayName }}</span>
                <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
                    {{ selectedStat?.matchCount }}
                </span>
            </button>
            <!-- Sibling of the back button, and nudged out of the header's own
                 1rem of padding, so the star lands on the same column as the
                 stars on the rows below -- which are inset by 0.5rem from their
                 own border instead. `ml-4` is the row button's `px-4`: it puts
                 the same gap in front of the count. -->
            <SearchSegmentFilterFavoriteStar
                v-if="selectedStat?.mediaPublicId"
                :media="selectedStat"
                class="ml-4 -mr-2" />
        </template>

        <template v-if="level === 'titles'" #subheader>
            <div class="flex flex-inline shrink-0">
                <input type="search" v-model="querySearchMedia" id="default-search2" autocomplete="off"
                    class="block w-full p-4 pl-4 text-xs xxl:text-sm xxm:text-xl text-gray-900 dark:bg-neutral-800  dark:placeholder-gray-400 dark:text-white/45 dark:focus:ring-input-focus-ring dark:focus:border-input-focus-ring"
                    :placeholder="$t('filterContent.searchPlaceholder')" required />
                <div class="absolute z-10 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
                    <svg aria-hidden="true" class="w-5 h-5 text-white/60 dark:text-gray-400" fill="none"
                        stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
            </div>
        </template>

        <Transition name="nd-drilldown" mode="out-in" @after-enter="applyPendingFocus">
        <div :key="level" v-if="level === 'episodes'">
            <SearchSegmentFilterRow
                v-for="episode in episodesList"
                :key="episode.episode"
                truncate
                :label="`${$t('searchpage.main.labels.episode')} ${episode.episode}`"
                :count="episode.count"
                :selected="selectedEpisode === episode.episode"
                :title="`${$t('searchpage.main.labels.episode')} ${episode.episode}: ${episode.count}`"
                @select="toggleEpisode(episode.episode)">
                <!-- An episode is not a thing you star, but the title above it is:
                     the empty star column keeps these counts under that one. -->
                <template #trailing>
                    <SearchSegmentFilterFavoriteStar :media="{ mediaPublicId: null }" class="mr-2" />
                </template>
            </SearchSegmentFilterRow>
            <div v-if="episodesList.length === 0" class="px-4 py-2 text-xs text-gray-400 dark:text-gray-500">
                {{ $t('episodeFilter.noEpisodes') }}
            </div>
        </div>

        <div :key="level" v-else>
            <SearchSegmentFilterRow
                v-for="item in filteredMedia"
                :key="item.mediaPublicId || 'all'"
                :row-id="item.mediaPublicId"
                :label="item.displayName"
                :count="item.matchCount"
                :selected="(!item.mediaPublicId && selectedMediaId === null) || item.mediaPublicId === selectedMediaId"
                @select="filterAnime(item.mediaPublicId, item.displayName, item.slug)">
                <!-- The "All" row gets no star at all, rather than a disabled one
                     that explains nothing; the component holds its column open. -->
                <template #trailing>
                    <SearchSegmentFilterFavoriteStar :media="item" class="mr-2" />
                </template>
            </SearchSegmentFilterRow>
        </div>
        </Transition>
    </SearchSegmentFilterPanelShell>
</template>
