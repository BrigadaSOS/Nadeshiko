<script setup lang="ts">
import { mdiArrowUp } from '@mdi/js';
import { usePlayerStore } from '~/stores/player';
import { storeToRefs } from 'pinia';
import type { SearchSidebarData } from '~/types/search';
import { splitLocalePrefix } from '~/utils/routes';

const showScrollButton = ref(false);
// Survives the remount when a browsed title (`/media/<slug>`) goes back to
// `/search`: that hop is the same list with a wider filter, and a drawer the
// reader was working in has to still be there when they land. A local ref
// reset on every page, so back looked like it had dismissed it.
const isFilterDrawerOpen = useState('nd-search-filter-drawer-open', () => false);
// Set immediately before a `/search` ↔ `/media/<slug>` remount. The drawer
// stays visible across that hop, so animating its newly mounted shell would
// make a continuous panel look as though it had just been opened again.
const skipFilterDrawerEnter = useState('nd-search-filter-drawer-skip-enter', () => false);

const isSearchFilterRoute = (path: string) => {
  const { localizedPath } = splitLocalePrefix(path);
  return localizedPath === '/search' || localizedPath.startsWith('/search/') || /^\/media\/[^/]+/.test(localizedPath);
};

// Drop the latch when leaving this list entirely, so a later visit to search
// does not reopen a drawer that was last used on a different page.
onBeforeRouteLeave((to) => {
  if (!isSearchFilterRoute(to.path)) isFilterDrawerOpen.value = false;
});

const playerStore = usePlayerStore();
const { showPlayer } = storeToRefs(playerStore);
const props = withDefaults(
  defineProps<{
    searchData?: SearchSidebarData | null;
    categorySelected?: string | null;
    /** Passed straight through to the filter panel; see its own prop docs. */
    activeMediaId?: string | null;
    /**
     * Whether this view has a list worth filtering. False on the single-sentence
     * page, which shows one card the filters cannot narrow -- the `2xl:` sidebar
     * has always been hidden there, and the drawer used to offer itself anyway:
     * picking a title from it pushed `?media=` onto `/sentence/<id>`, a query
     * that page ignores.
     */
    filterable?: boolean;
  }>(),
  { filterable: true },
);

/**
 * The drawer is offered only when there is a title list behind it.
 *
 * Keyed on the media stats rather than on the results, and the difference is
 * the whole point: `results` is emptied at the start of every fetch, so gating
 * on it made the button vanish and come back on each search, and left anyone
 * who opened it mid-flight looking at a drawer with nothing in it. The stats
 * survive the fetch and only empty when the query genuinely matched no titles
 * -- which is exactly when there is nothing to filter and no button to offer.
 *
 * Only the drawer is gated. The scroll-to-top button beside it is about the
 * page, not the results, and belongs on every view.
 */
const showFilterDrawer = computed(() => props.filterable && (props.searchData?.media?.length ?? 0) > 0);

// A drawer left open when its own contents go away -- a new search that matched
// no titles -- would otherwise spring back open the moment some arrived again.
watch(showFilterDrawer, (available) => {
  if (!available) isFilterDrawerOpen.value = false;
});

const { scrollBehavior } = useMotionPreference();

const handleScroll = () => {
  showScrollButton.value = window.scrollY > 400;
};

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
  // `appear` is read only on the modal's first render. Clearing the hand-off
  // flag now makes later genuine opens animate normally.
  skipFilterDrawerEnter.value = false;
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>
<template>

<div 
    class="fixed right-[calc(1.5rem+var(--scrollbar-gutter))] z-50 group transition-all duration-300 ease-in-out"
    :class="showPlayer ? 'bottom-40 md:bottom-24' : 'bottom-6'"
  >    <Transition>
      <button type="button" v-if="showScrollButton" data-testid="scroll-to-top" @click="scrollToTop"
        class="flex items-center justify-center outline-none mb-2  bg-sgray rounded-full w-14 h-14 hover:bg-sgrayhover dark:bg-header-background focus:ring-4 focus:outline-none">
        <UiBaseIcon :path="mdiArrowUp" w="5" h="5" size="20" fill="white" strokewidth="1" stroke="white" />
      </button>
    </Transition>
    <button v-if="showFilterDrawer" type="button" aria-haspopup="dialog" :aria-expanded="isFilterDrawerOpen"
      aria-controls="nd-offcanvas-right"
      data-testid="filter-drawer-toggle"
      @click="isFilterDrawerOpen = !isFilterDrawerOpen"
      class="flex items-center justify-center outline-none 2xl:hidden text-white bg-sgray rounded-full w-14 h-14 hover:bg-sgrayhover dark:bg-header-background focus:ring-4 focus:outline-none">
      <svg aria-hidden="true" class="w-8 h-8 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg">
        <path xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd"
          d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          fill="#ffffff" />
      </svg>
      <span class="sr-only">{{ $t('segmentSidebar.openFilters') }}</span>
    </button>
  </div>

  <!-- Sidebar -->
  <CommonBaseModal
    v-if="showFilterDrawer"
    id="nd-offcanvas-right"
    data-testid="filter-drawer"
    :open="isFilterDrawerOpen"
    :appear="!skipFilterDrawerEnter"
    transition="nd-drawer"
    z-index-class="z-[80]"
    panel-class="h-full max-w-sm w-full bg-surface border-s border-hairline flex flex-col overflow-hidden"
    labelledby="nd-offcanvas-right-label"
    @close="isFilterDrawerOpen = false"
  >
  <div class="flex justify-between items-center py-3 px-4 border-b border-hairline shrink-0">
    <h3 id="nd-offcanvas-right-label" class="font-bold text-ink">
      {{ $t('segmentSidebar.filtersTitle') }}
    </h3>
    <button type="button" class="size-8 inline-flex justify-center items-center rounded-full bg-surface-hover text-ink-muted hover:text-ink hover:bg-lift focus:outline-none" @click="isFilterDrawerOpen = false">
      <span class="sr-only">{{ $t('segmentSidebar.close') }}</span>
      <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    </button>
  </div>
  <!-- A flex column ending in the filter panel, so the drawer header stays put
       and the row list is the only thing that scrolls. -->
  <!-- No empty state and no skeleton: the drawer only exists when there are
       titles in it, so both branches were unreachable. The skeleton that used to
       sit here was `hidden lg:block` inside a drawer that only opens below
       `2xl`, which left every phone with a blank panel instead. -->
  <div class="flex-1 min-h-0 flex flex-col">
        <!-- Keep the drawer open while picking titles and episodes: it is a
             drill-down control, and staying here lets the reader refine or
             switch scope without reopening it. Sort still closes after a pick.
             Flush: the drawer is already framed, so a padded inner card left a
             gutter down both sides. -->
        <SearchSegmentFilterContent
          flush
          :searchData="searchData"
          :categorySelected="categorySelected"
          :activeMediaId="activeMediaId"
          @applied="isFilterDrawerOpen = false"
          @preserving-drawer="skipFilterDrawerEnter = true">
          <template #before>
            <SearchSegmentFilterSortContent @sort-selected="isFilterDrawerOpen = false" />
          </template>
        </SearchSegmentFilterContent>
  </div>
  </CommonBaseModal>

  <!-- End Sidebar -->

</template>
