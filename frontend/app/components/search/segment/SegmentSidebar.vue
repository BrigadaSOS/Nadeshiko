<script setup lang="ts">
import { mdiArrowUp } from '@mdi/js';
import { usePlayerStore } from '~/stores/player';
import { storeToRefs } from 'pinia';
import type { SearchSidebarData } from '~/types/search';

const showScrollButton = ref(false);
const isFilterDrawerOpen = ref(false);

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

const handleScroll = () => {
  showScrollButton.value = window.scrollY > 400;
};

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'instant' });
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});
</script>
<template>

<div 
    class="fixed right-6 z-50 group transition-all duration-300 ease-in-out"
    :class="showPlayer ? 'bottom-40 md:bottom-24' : 'bottom-6'"
  >    <Transition>
      <button type="button" v-if="showScrollButton" @click="scrollToTop"
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
    transition="nd-drawer"
    z-index-class="z-[80]"
    panel-class="h-full max-w-sm w-full bg-white border-s dark:bg-neutral-800 dark:border-neutral-700 flex flex-col overflow-hidden"
    labelledby="nd-offcanvas-right-label"
    @close="isFilterDrawerOpen = false"
  >
  <div class="flex justify-between items-center py-3 px-4 border-b dark:border-neutral-700 shrink-0">
    <h3 id="nd-offcanvas-right-label" class="font-bold text-gray-800 dark:text-white">
      {{ $t('segmentSidebar.filtersTitle') }}
    </h3>
    <button type="button" class="size-8 inline-flex justify-center items-center gap-x-2 rounded-full border border-transparent bg-gray-100 text-gray-800 hover:bg-gray-200 focus:outline-none focus:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-400 dark:focus:bg-neutral-600" @click="isFilterDrawerOpen = false">
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
    <div class="p-2 flex-1 min-h-0 flex flex-col gap-2">
        <!-- Sorting reorders the list this drawer is sitting on top of, so it
             closes for the same reason picking a title does. -->
        <SearchSegmentFilterSortContent @sort-selected="isFilterDrawerOpen = false" />
        <!-- Picking a title or an episode is the whole reason the drawer was
             opened: close it so the reader lands back on the results it just
             filtered, instead of on the panel that filtered them. -->
        <SearchSegmentFilterContent
          :searchData="searchData"
          :categorySelected="categorySelected"
          :activeMediaId="activeMediaId"
          @applied="isFilterDrawerOpen = false" />
      </div>
  </div>
  </CommonBaseModal>

  <!-- End Sidebar -->

</template>
