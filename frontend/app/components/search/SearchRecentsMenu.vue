<script setup lang="ts">
import { mdiClose } from '@mdi/js';
import { RECENTS_LISTBOX_ID, recentOptionId, type RecentSearch } from '~/utils/searchRecents';

/**
 * The reader's last searches, under the search bar.
 *
 * Presentation only: the input owns the open/closed state and the highlight,
 * because it owns the keyboard -- ↑/↓ arrive there, not here. This renders the
 * rows it is handed and reports clicks back.
 *
 * A press anywhere in the menu that is not a row prevents its own default, so
 * clicking the header, the padding or the gap between rows does not pull focus
 * out of the box the reader is still typing in.
 */
defineProps<{
  items: RecentSearch[];
  /** The highlighted row, or -1 when the reader's Enter still belongs to their typing. */
  activeIndex: number;
  loading?: boolean;
  clearing?: boolean;
  /** `/user/activity` is behind auth, so the link is only offered to a reader who can open it. */
  showSeeAll?: boolean;
  /**
   * Whether the reader is actually here. The bar owns this and both halves wear
   * it together -- the menu is the rest of that surface, so it cannot be lit
   * while the bar is not. See the input's own accent class.
   */
  accented?: boolean;
}>();

const emit = defineEmits<{
  select: [index: number];
  forget: [index: number];
  clear: [];
  activate: [index: number];
  deactivate: [];
}>();

const { t } = useI18n();
const localePath = useLocalePath();
</script>

<template>
  <!--
    Welded to the bar rather than floating under it, and the whole of that is
    about one seam.

    `-mt-px` puts the menu's background over the bar's bottom border instead of
    stacking two 1px lines into a 2px one, and it has no top border of its own:
    a line across the middle of what should read as one surface is the seam we
    are hiding. The three sides it does draw take the bar's focused border, since
    a grey half below a light half is that seam again. The top corners are square
    -- they round only while it is detached, in the enter/leave classes, so the
    fusing is animated rather than switched.

    The shadow is aimed down on purpose, and further down than it looks like it
    needs to be. The menu paints on top of the bar, so any part of its shadow
    that reaches above its own top edge lands on the bar as a darker band -- 8px
    of `rgb(46,46,46)` against the bar's `rgb(47,47,47)`, faint enough to read as
    a seam rather than as a shadow. Tailwind's `shadow-lg` bleeds that way
    outright; so did `0 14px 28px -8px`, because Chrome's blur approximation
    still leaks past half the blur radius -- measured, it reaches back up by
    roughly the whole radius, not half of it. So the offset clears the blur
    outright with the spread pulled in behind it: 20 + 8 puts the shadow rect's
    top 28px down against a 24px reach, and the strip above the seam scans a
    uniform `rgb(47,47,47)`.
  -->
  <div
    class="absolute inset-x-0 top-full z-40 -mt-px overflow-hidden rounded-b-lg border border-t-0 border-gray-200 bg-white shadow-[0_20px_24px_-8px_rgba(0,0,0,0.45)] transition-colors duration-200 ease-out motion-reduce:transition-none dark:bg-input-background dark:shadow-[0_20px_24px_-8px_rgba(0,0,0,0.6)]"
    :class="accented ? 'dark:border-input-focus-ring' : 'dark:border-neutral-600'"
    data-testid="search-recents"
    @mousedown.prevent
  >
    <!-- No rule under the header: it read as the menu having grown a spare empty
         row, and the label already reads as a label. -->
    <div class="flex items-center justify-between gap-3 px-4 py-2">
      <span class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-neutral-400">
        {{ t('searchRecents.title') }}
      </span>
      <div class="flex items-center gap-3">
        <NuxtLink
          v-if="showSeeAll"
          :to="localePath('/user/activity')"
          class="text-xs text-gray-500 hover:text-gray-900 hover:underline dark:text-neutral-400 dark:hover:text-white"
        >
          {{ t('searchRecents.seeAll') }}
        </NuxtLink>
        <button
          type="button"
          data-testid="search-recents-clear"
          class="text-xs text-gray-500 hover:text-gray-900 hover:underline disabled:opacity-50 dark:text-neutral-400 dark:hover:text-white"
          :disabled="clearing"
          @click="emit('clear')"
        >
          {{ clearing ? t('searchRecents.clearing') : t('searchRecents.clear') }}
        </button>
      </div>
    </div>

    <!-- No padding around the rows: a highlighted first or last row would stop
         short of the card's edge, leaving a band of card background above or
         below it that reads as the hover being misaligned rather than as
         breathing room. The card's own `overflow-hidden` clips the last row to
         the rounded bottom. -->
    <ul :id="RECENTS_LISTBOX_ID" role="listbox" :aria-label="t('searchRecents.title')">
      <li
        v-for="(item, index) in items"
        :id="recentOptionId(index)"
        :key="item.query"
        role="option"
        :aria-selected="index === activeIndex"
        data-testid="search-recents-item"
        class="group flex cursor-pointer items-center gap-3 px-4 py-2 text-sm"
        :class="
          index === activeIndex
            ? 'bg-gray-100 text-gray-900 dark:bg-white/10 dark:text-white'
            : 'text-gray-700 dark:text-white/80'
        "
        @click="emit('select', index)"
        @mouseenter="emit('activate', index)"
        @mouseleave="emit('deactivate')"
      >
        <span class="truncate">{{ item.query }}</span>
        <!--
          The title a scoped search was run inside, in its own pill: without it
          two rows reading `食べる` would be the same row twice, and clicking
          one of them would go somewhere the other did not.
        -->
        <span
          v-if="item.media"
          data-testid="search-recents-media"
          class="inline-flex max-w-[12rem] flex-shrink-0 items-center truncate rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:border-neutral-600 dark:bg-white/10 dark:text-neutral-400"
        >
          {{ item.media.name || t('searchRecents.inOneTitle') }}
        </span>
        <button
          type="button"
          data-testid="search-recents-forget"
          class="ml-auto flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-gray-900 focus:opacity-100 group-hover:opacity-100 dark:text-neutral-500 dark:hover:text-white"
          :aria-label="t('searchRecents.forget', { query: item.query })"
          :title="t('searchRecents.forget', { query: item.query })"
          @click.stop="emit('forget', index)"
        >
          <UiBaseIcon :path="mdiClose" w="w-4" h="h-4" size="16" />
        </button>
      </li>
    </ul>

    <p v-if="loading" class="px-4 pb-2 text-xs text-gray-400 dark:text-neutral-500">
      {{ t('searchRecents.loading') }}
    </p>
  </div>
</template>
