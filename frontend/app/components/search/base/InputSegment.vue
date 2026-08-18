<script setup lang="ts">
import { mdiClose, mdiTextSearch } from '@mdi/js';
import { decodeSearchQuery } from '~/utils/routes';
import { RECENTS_LISTBOX_ID, recentOptionId } from '~/utils/searchRecents';

const props = withDefaults(
  defineProps<{
    /**
     * The title this page is already scoped to, when the ROUTE carries that
     * scope rather than `?media=` -- i.e. on `/media/<slug>`.
     *
     * Searching from inside a title has always stayed inside it, because the
     * scope was a query parameter the search target simply carried over. On a
     * media page there is no such parameter to carry, so without this a search
     * from a title page would silently widen to the whole corpus.
     */
    scopeMediaId?: string | null;
  }>(),
  {
    scopeMediaId: null,
  },
);

const localePath = useLocalePath();
const router = useRouter();

/**
 * Vue Router's live route rather than Nuxt's `useRoute()`, because on this page
 * the two disagree for a few hundred milliseconds and the bar was reading the
 * loser.
 *
 * Nuxt only re-points `useRoute()` at the incoming URL once the incoming *page*
 * renders, and deliberately skips its `afterEach` sync whenever the page key
 * changes (`pages/runtime/plugins/router.js`). `/search/[[query]]` keys on the
 * query, so every token click changes it: the page remounts, its `useAsyncData`
 * suspends the new subtree, and `useRoute()` stays on the old word until that
 * second fetch lands. Meanwhile `SearchContainer`'s own `onBeforeRouteUpdate`
 * has already swapped the results in underneath -- so the bar sat there naming
 * the previous search while the sentences below it were the new one.
 *
 * `currentRoute` updates when the navigation is confirmed, which is the moment
 * the URL says a different search is what we are showing.
 */
const route = router.currentRoute;
const user = userStore();

/**
 * The search the URL is on, from either shape the route can carry it in: the
 * `/search/:query` segment, or `?query=` on the pages that still use it.
 *
 * `decodeSearchQuery` and not a bare `decodeURIComponent`: the router hands the
 * param through raw, and a malformed escape (`%E8%AD`, `%C0%80`) throws a
 * `URIError` out of an unguarded decode -- here that would have been a throw
 * inside setup, which is a 500.
 */
const searchInUrl = computed(() => {
  const { params, query: queryParams } = route.value;
  return params.query ? decodeSearchQuery(String(params.query)) : String(queryParams.query || '');
});

/**
 * What the box shows. Seeded from the URL and re-seeded whenever it changes, so
 * a search that is in the address bar is always the search in the search bar --
 * typed, clicked off a token, restored from history or pasted in cold. It stays
 * a ref rather than the computed itself because the reader edits it between
 * navigations.
 */
const query = ref(searchInUrl.value);

watch(searchInUrl, (value) => {
  query.value = value;
});

const forceSearchCounter = useState('force-search-counter', () => 0);
const inputRef = ref<HTMLInputElement | null>(null);
const searchBarRef = ref<HTMLElement | null>(null);

const recents = useSearchRecents();
const isRecentsOpen = ref(false);
/** The highlighted row, or -1 while Enter still belongs to what the reader typed. */
const activeIndex = ref(-1);

const recentItems = computed(() => (isRecentsOpen.value ? recents.narrow(query.value) : []));
const showRecents = computed(() => isRecentsOpen.value && recentItems.value.length > 0);

/**
 * Whether the reader is actually in this window.
 *
 * The field keeps DOM focus while they are in another window or tab, so `:focus`
 * cannot express "nobody is here" and the bar would sit lit on a page the reader
 * has walked away from. This says it instead, and both halves of the card read
 * from it, so the accent leaves and returns as one surface.
 *
 * Defaults to focused rather than to `document.hasFocus()` so the server and the
 * first client render agree; the real answer arrives on mount.
 */
const isWindowFocused = ref(true);
onMounted(() => {
  isWindowFocused.value = document.hasFocus();
});
useEventListener(window, 'focus', () => {
  isWindowFocused.value = true;
});
useEventListener(window, 'blur', () => {
  isWindowFocused.value = false;
});

/**
 * The bar's half of the shared open border.
 *
 * Away, `!` is load-bearing: the input still matches `:focus`, and a plain
 * border utility loses to `border-hairline` on the same node. Here, the
 * lighter line is held for as long as the menu is standing whether or not the
 * field itself still has focus, since the two are one card. This is the 1px
 * border, not the offset focus ring.
 */
const barAccentClass = computed(() => {
  if (!isWindowFocused.value) return '!border-hairline';
  return showRecents.value ? '!border-open' : '';
});

/**
 * The box is focused programmatically below, and that focus is not the reader
 * asking for their history: without this the menu would be open on arrival at
 * every page the bar renders on. Cleared on the next task as well as on use,
 * so a `focus()` on an already-focused input -- which fires no event -- cannot
 * leave it armed for the reader's next click.
 */
let ignoreNextFocus = false;

const openRecents = () => {
  if (isRecentsOpen.value) return;
  isRecentsOpen.value = true;
  activeIndex.value = -1;
  // Loaded on the first open rather than on mount: the bar renders on four
  // pages, and a reader who never opens the menu should cost no request.
  recents.load();
};

const closeRecents = () => {
  isRecentsOpen.value = false;
  activeIndex.value = -1;
};

onMounted(() => {
  const isMobile = /Android|webOS|iPhone|iPad|Opera Mini/i.test(navigator.userAgent);
  if (!isMobile) {
    ignoreNextFocus = true;
    inputRef.value?.focus({ preventScroll: true });
    setTimeout(() => {
      ignoreNextFocus = false;
    }, 0);
  }
});

// Only a press elsewhere in the page dismisses the menu. Leaving the window does
// not: you looked a word up in order to use it somewhere else, so the list has to
// still be there when you come back.
onClickOutside(searchBarRef, closeRecents);

/**
 * `scope` is only passed when a remembered search is being re-run, and it
 * replaces whatever title the current URL is filtered to -- including replacing
 * it with nothing. A recent carries its own scope, so a general 食べる clicked
 * from inside a show has to leave that show, and one recorded inside a show has
 * to go back to it from anywhere. The episode goes with it either way: it
 * narrowed a search the reader had already decided on.
 */
const navigateSearchSentence = async (options: { scope?: string | null } = {}) => {
  const { query: _query, hideLangs: _, blurLangs: __, ...restOfQuery } = route.value.query;
  const term = query.value?.trim();

  let nextQuery: typeof restOfQuery = restOfQuery;
  if (options.scope !== undefined) {
    const { media: _m, mediaId: _mi, episode: _e, episodeId: _ei, ...unscoped } = restOfQuery;
    nextQuery = options.scope ? { ...unscoped, media: options.scope } : unscoped;
  } else if (props.scopeMediaId && !restOfQuery.media && !restOfQuery.mediaId) {
    // Carry the page's own scope into the search URL, which is where the scope
    // has to live once the destination is `/search/<word>` rather than the title
    // page. Not applied when a recent search supplied its own (`options.scope`),
    // and not when the URL already names a title.
    nextQuery = { ...restOfQuery, media: props.scopeMediaId };
  }

  const remaining = Object.keys(nextQuery).length > 0 ? nextQuery : undefined;

  const target = {
    path: term ? localePath(`/search/${encodeURIComponent(term)}`) : localePath('/search'),
    query: remaining,
  };

  // If already at the target URL, skip navigation and signal SearchContainer to re-fetch.
  if (router.resolve(target).fullPath === route.value.fullPath) {
    forceSearchCounter.value++;
    return;
  }

  await navigateTo(target);
};

/**
 * Re-runs a remembered search: the row's text becomes the query, and the row's
 * own scope becomes the filter, rather than whichever one the page is wearing.
 */
const runRecent = (index: number) => {
  const item = recentItems.value[index];
  if (!item) return;

  query.value = item.query;
  closeRecents();
  navigateSearchSentence({ scope: item.media?.publicId ?? null });
};

/**
 * Enter never picks a recent unless the reader arrowed onto one: no row is
 * preselected, so Enter on a typed query submits that query, and Enter on an
 * empty box still walks back to the search landing page.
 */
const submitFromInput = () => {
  if (activeIndex.value >= 0) {
    runRecent(activeIndex.value);
    return;
  }
  closeRecents();
  navigateSearchSentence();
};

const submitFromSearchButton = () => {
  closeRecents();
  navigateSearchSentence();
};

const forgetRecent = (index: number) => {
  const item = recentItems.value[index];
  if (!item) return;

  activeIndex.value = -1;
  recents.forget(item);
};

const clearRecents = async () => {
  await recents.clear();
  activeIndex.value = -1;
};

const onInputFocus = () => {
  if (ignoreNextFocus) {
    ignoreNextFocus = false;
    return;
  }
  openRecents();
};

const onInputKeydown = (event: KeyboardEvent) => {
  // A key the IME is still holding is not navigation: 229 is the legacy
  // spelling of "this went to the IME, not to you", as in `useEnterSubmit`.
  if (event.isComposing || event.keyCode === 229) return;

  if (event.key === 'Escape') {
    if (!isRecentsOpen.value) return;
    event.preventDefault();
    closeRecents();
    return;
  }

  if (event.key === 'Tab') {
    closeRecents();
    return;
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

  if (!isRecentsOpen.value) {
    openRecents();
    return;
  }

  const count = recentItems.value.length;
  if (count === 0) return;

  // Otherwise the caret jumps to either end of the query being edited.
  event.preventDefault();

  if (event.key === 'ArrowDown') {
    activeIndex.value = activeIndex.value >= count - 1 ? -1 : activeIndex.value + 1;
  } else {
    activeIndex.value = activeIndex.value <= -1 ? count - 1 : activeIndex.value - 1;
  }
};

// Enter submits, except when it is confirming an IME conversion -- see #399.
const enterSubmit = useEnterSubmit(submitFromInput);

/**
 * One merged handler set rather than `v-on` plus a second `@keydown`, so the
 * order the two see a key in is stated here instead of falling out of the
 * template: the menu's own keys are handled first, and `useEnterSubmit` still
 * owns Enter.
 */
const inputHandlers = {
  ...enterSubmit,
  focus: onInputFocus,
  keydown: (event: KeyboardEvent) => {
    onInputKeydown(event);
    enterSubmit.keydown(event);
  },
};

// A typed key changes what the menu is showing, so a row highlighted before it
// is no longer the row Enter would take.
watch(query, () => {
  activeIndex.value = -1;
});

const showBatchModal = ref(false);
</script>
<template>
  <SearchModalBatch :open="showBatchModal" @close="showBatchModal = false" />

  <!-- Form -->
  <div class="yomitan-ignore">
    <div
      ref="searchBarRef"
      class="relative flex space-x-3 rounded-lg shadow-gray-100 dark:border-neutral-500"
    >
      <div class="relative flex-[1_0_0%]">
        <label for="sentence-search-input" class="block text-sm text-gray-700 font-medium dark:text-white"><span
            class="sr-only">{{ $t('common.searchAnything') }}</span></label>
        <!--
          The bar gives up the two corners it shares with the menu while the menu
          is standing, and holds the lighter open border there whether or not
          the field still has focus -- both halves are one surface, so they wear
          one line. Morphed rather than switched: the fusing is the part that
          reads as one card unfurling instead of two stacked ones.
        -->
        <input ref="inputRef" id="sentence-search-input" data-testid="search-input" v-model="query" v-on="inputHandlers"
          role="combobox" aria-autocomplete="list" :aria-expanded="showRecents" :aria-controls="RECENTS_LISTBOX_ID"
          :aria-activedescendant="activeIndex >= 0 ? recentOptionId(activeIndex) : undefined" autocomplete="off"
          @pointerdown="openRecents"
          :class="[showRecents ? 'rounded-b-none' : '', barAccentClass]"
          class="border py-3 h-full pl-4 pr-4 md:pr-32 block w-full rounded-lg bg-input-background border-hairline text-ink placeholder:text-ink-faint text-base outline-none transition-[border-radius,border-color] duration-200 ease-out motion-reduce:transition-none"
          :placeholder="$t('common.searchAnything')" />

        <!--
          Origin at the top and a small upward offset, so it reads as the list
          unfurling out of the bar rather than a card fading in beside it. The
          top corners are round only in these two states -- detached -- and morph
          square as it merges into the bar.
        -->
        <Transition
          enter-active-class="origin-top transition-[opacity,transform,border-radius] duration-200 ease-out motion-reduce:transition-none"
          enter-from-class="opacity-0 -translate-y-1.5 scale-y-[0.985] rounded-t-lg"
          leave-active-class="origin-top transition-[opacity,transform,border-radius] duration-150 ease-in motion-reduce:transition-none"
          leave-to-class="opacity-0 -translate-y-1.5 scale-y-[0.985] rounded-t-lg">
          <SearchRecentsMenu v-if="showRecents" :items="recentItems" :active-index="activeIndex"
            :loading="recents.loading.value" :clearing="recents.clearing.value" :show-see-all="user.isLoggedIn"
            :accented="isWindowFocused" @select="runRecent" @forget="forgetRecent" @clear="clearRecents"
            @activate="activeIndex = $event" @deactivate="activeIndex = -1" />
        </Transition>
        <div class="absolute inset-y-0 end-3 flex items-center pointer-events-none">
          <span
            class="hidden md:inline-flex items-center whitespace-nowrap py-3 text-center gap-x-1 text-base text-gray-400 dark:text-white">
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 font-mono text-sm rounded-md bg-control border border-hairline text-ink">
              <svg class="flex-shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round">
                <path d="M9 18v-6H5l7-7 7 7h-4v6H9z"></path>
              </svg>
            </kbd>
            +
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 font-mono text-sm rounded-md bg-control border border-hairline text-ink">
              S
            </kbd>
          </span>
          <!-- End KBD -->
        </div>

      </div>
      <!--
        Gone below `md`, where the on-screen keyboard's Go key is how a search is
        submitted anyway and two icon buttons cost a third of the bar. The input
        column takes the width back, and the recents menu is anchored to that
        column (`inset-x-0` in SearchRecentsMenu), so the history runs the full
        width of the bar without being repositioned.
      -->
      <div class="hidden md:grid grid-cols-2 gap-2">
        <button
          data-testid="search-button"
          class="col-span-1 py-4 px-4 border border-hairline inline-flex justify-center items-center text-sm font-semibold rounded-lg bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          @click="submitFromSearchButton">
          <svg class="flex-shrink-0 size-5" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>

        <button
          class="col-span-1 py-4 px-4 border border-hairline inline-flex justify-center items-center text-sm font-semibold rounded-lg bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          @click="showBatchModal = true">
          <UiBaseIcon :path="mdiTextSearch" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
        </button>
      </div>
    </div>
  </div>
  <!-- End Form -->
</template>
