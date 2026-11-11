<script setup lang="ts">
import { useTimeoutFn } from '@vueuse/core';
import { mdiChevronLeft } from '@mdi/js';
import { CATEGORY_API_MAPPING } from '~/utils/categories';
import { episodeLabel } from '~/utils/media';
import { EPISODE_HITS_LOADING } from '~/composables/useSearchFetch';
import { compareMediaRows, MEDIA_SORT_MODES, type MediaSortMode } from '~/utils/mediaFilterSort';
import type { ResolvedMediaStats, SearchSidebarData } from '~/types/search';

/** One title in the media filter list. */
type MediaFilterRow = {
  mediaPublicId: string;
  /** Absent on any payload predating slug support. */
  slug?: string | null;
  displayName: string;
  displayNameLower: string;
  matchCount: number;
  /** Tags non-anime titles in the mixed list. */
  category?: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

const route = useRoute();
const { setQuery } = useQuerySync();
const { isMediaPage, selectMedia } = useMediaScope();
const { mediaName: getMediaName } = useMediaName();
// Only the ordering is needed here; the star itself owns toggling.
const { favoriteMediaIds } = useFavoriteMedia();
const { inferredRank } = useFamiliarMedia();
const { mode: sortMode, setMode: setSortMode } = useMediaFilterSort();
// Static keys, so the locale checker sees them used.
const SORT_MODE_LABEL_KEYS: Record<MediaSortMode, string> = {
  alphabetical: 'filterContent.sort.alphabetical',
  matches: 'filterContent.sort.matches',
};
const props = defineProps<{
  searchData?: SearchSidebarData | null;
  categorySelected?: string | null;
  /** Passed through to the panel chrome; see FilterPanelShell. */
  flush?: boolean;
  /**
   * The title currently in scope, when the ROUTE names it rather than `?media=`
   * -- i.e. on `/media/<slug>`. Without it this panel reads the query string,
   * finds nothing, and shows the title list as though nothing were selected on
   * the very page that is scoped to one title.
   */
  activeMediaId?: string | null;
}>();
// Raised only for an episode pick: that is the final narrowing action, so the
// mobile drawer gets out of the way and reveals the results. Title picks stay
// open to support browsing through a title's episodes.
const emit = defineEmits<{ applied: []; preservingDrawer: [] }>();
const mediaStatistics = ref<ResolvedMediaStats[]>([]);
const querySearchMedia = ref('');
const debouncedQuerySearchMedia = ref('');
const categorySelected = ref<string>(props.categorySelected ?? 'all');
const categoryApiMapping = CATEGORY_API_MAPPING;

// In the mixed "All" list an anime and an audiobook can share a name, so every non-anime title
// says what it is. Anime is most of the corpus and stays untagged, and a single-category list
// needs no tag at all. Static keys, so the locale checker sees them used.
const CATEGORY_BADGE_KEYS: Partial<Record<string, string>> = {
  JDRAMA: 'filterContent.categoryBadge.jdrama',
  YOUTUBE: 'filterContent.categoryBadge.youtube',
  AUDIOBOOK: 'filterContent.categoryBadge.audiobook',
};
/** The i18n key of a title's category tag, or undefined when it shows none. */
const categoryBadgeKey = (category: string | undefined): string | undefined =>
  categorySelected.value === 'all' && category ? CATEGORY_BADGE_KEYS[category] : undefined;

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

  const filteredItems = normalizedStatistics.value.filter((item) => {
    const categoryFilter = categorySelected.value === 'all' || item.category === selectedCategory;
    const nameFilterEnglish = item.nameEnLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterJapanese = item.nameJaLower.includes(debouncedQuerySearchMedia.value);
    const nameFilterRomaji = item.nameRomajiLower.includes(debouncedQuerySearchMedia.value);

    return categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji);
  });

  // A–Z: starred first, then what the reader studies, then the rest by name.
  // Most sentences: starred first, then everything else by count. See
  // `compareMediaRows`.
  return filteredItems.sort((a, b) =>
    compareMediaRows(a, b, favoriteMediaIds.value, inferredRank.value, sortMode.value),
  );
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
    .map((entry) => ({ episode: entry.episode, title: entry.title ?? null, count: entry.hitCount }))
    .sort((a, b) => a.episode - b.episode);
});

/**
 * The counts above are no longer in the page payload for every title -- see
 * `stripEpisodeHits` -- so drilling into one on a search page has a request in
 * front of it. Without this the reader is told "no episodes found" for the
 * length of that request, on a title that plainly has some.
 */
const episodeHitsLoading = inject(EPISODE_HITS_LOADING, readonly(ref(false)));

const filterAnime = (mediaPublicId: string, _animeName: string, slug?: string | null) => {
  // A second click on the title already in scope drops it, same as a second
  // click on an episode. Movies never drill in, so this is how they leave.
  if (mediaPublicId === selectedMediaId.value) {
    selectMedia(null);
    return;
  }
  // A bare search promotes a selected title into `/media/<slug>`. The drawer
  // remains open across that page remount, so its replacement must not replay
  // the enter animation.
  if (!route.params.query && slug) emit('preservingDrawer');
  // Where this lands depends on whether a word is being searched -- see
  // `useMediaScope`, which also owns dropping the episode along with the title.
  selectMedia(mediaPublicId, slug);
};

/** Back out of the episode level: drops the title and the episode under it. */
const backToTitles = () => {
  // The drawer remains open across this route change. Tell its new instance
  // that it is being restored rather than newly opened, so it does not slide
  // in a second time.
  if (isMediaPage.value) emit('preservingDrawer');
  selectMedia(null);
};

const toggleEpisode = (episode: number) => {
  const next = selectedEpisode.value === episode ? null : episode;
  setQuery({ episode: next === null ? null : String(next) }, { scroll: true });
  emit('applied');
};

/** After drilling in/out, restore focus to the back row or previous title. Only move focus if it started inside
 * this panel; result-card links can also change the level and must not have their focus stolen.
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
        :flush="flush">

        <template v-if="$slots.before" #before>
            <slot name="before" />
        </template>

        <!-- Episode level: the header IS the way back, and doubles as the
             reminder of which title you drilled into. -->
        <template v-if="level === 'episodes'" #header>
            <button
                type="button"
                :aria-label="$t('filterContent.backToTitles')"
                :title="selectedStat?.displayName"
                data-testid="media-filter-back"
                class="group flex flex-1 min-w-0 items-center gap-1 text-left outline-none"
                @click="backToTitles">
                <UiBaseIcon :path="mdiChevronLeft" size="18"
                    class="shrink-0 text-white/60 transition-transform duration-200 group-hover:-translate-x-0.5" />
                <span class="flex-1 min-w-0 truncate text-sm font-medium">{{ selectedStat?.displayName }}</span>
                <span class="bg-neutral-700 text-white rounded-lg px-3 ml-3 py-1 text-xs shrink-0">
                    {{ selectedStat?.matchCount }}
                </span>
            </button>
            <!-- Keep the star's visible icon 1.25rem from both the count and
                 the panel edge. Its own hit target supplies the final 0.25rem
                 on each side. -->
            <SearchSegmentFilterFavoriteStar
                v-if="selectedStat?.mediaPublicId"
                :media="selectedStat"
                class="ml-4" />
        </template>

        <template v-if="level === 'titles'" #subheader>
            <div class="relative">
                <input type="search" v-model="querySearchMedia" id="default-search2" autocomplete="off"
                    class="nd-input h-12 pr-10 text-sm xxl:text-base xxm:text-xl"
                    :placeholder="$t('filterContent.searchPlaceholder')" />
                <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <svg aria-hidden="true" class="w-4 h-4 text-ink-faint" fill="none"
                        stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                </div>
            </div>
            <!-- The list's own order, kept apart from the results sort above the
                 card: this only reorders the titles, never the sentences. -->
            <div
                role="group"
                :aria-label="$t('filterContent.sort.label')"
                data-testid="media-filter-sort"
                class="mt-3 flex gap-0.5 rounded-md border border-hairline p-0.5 text-xs">
                <button
                    v-for="option in MEDIA_SORT_MODES"
                    :key="option"
                    type="button"
                    :aria-pressed="sortMode === option"
                    :data-testid="`media-filter-sort-${option}`"
                    class="flex-1 rounded px-2 py-1 transition-colors motion-reduce:transition-none"
                    :class="sortMode === option
                        ? 'bg-control-hover text-ink font-semibold shadow-sm'
                        : 'text-ink-faint hover:text-ink'"
                    @click="setSortMode(option)">
                    {{ $t(SORT_MODE_LABEL_KEYS[option]) }}
                </button>
            </div>
        </template>

        <Transition name="nd-drilldown" mode="out-in" @after-enter="applyPendingFocus">
        <div :key="level" v-if="level === 'episodes'">
            <SearchSegmentFilterRow
                v-for="episode in episodesList"
                :key="episode.episode"
                truncate
                :label="episodeLabel($t, selectedStat, episode.episode, episode.title)"
                :count="episode.count"
                :selected="selectedEpisode === episode.episode"
                :title="`${episodeLabel($t, selectedStat, episode.episode, episode.title)}: ${episode.count}`"
                @select="toggleEpisode(episode.episode)">
                <!-- An episode is not a thing you star, but the title above it is:
                     the empty star column keeps these counts under that one. -->
                <template #trailing>
                    <SearchSegmentFilterFavoriteStar :media="{ mediaPublicId: null }" class="mr-2" />
                </template>
            </SearchSegmentFilterRow>
            <div v-if="episodesList.length === 0" :aria-busy="episodeHitsLoading">
                <div class="mx-5 border-t border-line-subtle" aria-hidden="true" />
                <div class="px-5 py-2 text-xs text-gray-400 dark:text-gray-500">
                    {{ episodeHitsLoading ? $t('segmentSidebar.loading') : $t('episodeFilter.noEpisodes') }}
                </div>
            </div>
        </div>

        <div :key="level" v-else>
            <SearchSegmentFilterRow
                v-for="item in filteredMedia"
                :key="item.mediaPublicId"
                :row-id="item.mediaPublicId"
                :label="item.displayName"
                :badge="categoryBadgeKey(item.category) ? $t(categoryBadgeKey(item.category)!) : undefined"
                :count="item.matchCount"
                :selected="item.mediaPublicId === selectedMediaId"
                @select="filterAnime(item.mediaPublicId, item.displayName, item.slug)">
                <template #trailing>
                    <SearchSegmentFilterFavoriteStar :media="item" class="mr-2" />
                </template>
            </SearchSegmentFilterRow>
        </div>
        </Transition>
    </SearchSegmentFilterPanelShell>
</template>
