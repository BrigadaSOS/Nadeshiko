<script setup lang="ts">
import { mdiClose } from '@mdi/js';
import { RECENTS_LISTBOX_ID, recentOptionId, type RecentSearch } from '~/utils/searchRecents';

/** The input owns state and keyboard navigation. Prevent non-row presses from pulling focus out of the
 * combobox.
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
   * the same open border -- the menu is the rest of that surface, so it cannot
   * be lit while the bar is not. See the input's own accent class.
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
  <!-- -mt-px hides the shared border; square top corners merge menu and bar. Offset the shadow beyond its blur
       reach so it cannot darken the bar and recreate a seam.
       -->
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: keeps focus in the combobox -->
  <div
    class="absolute inset-x-0 top-full z-40 -mt-px overflow-hidden rounded-b-lg border border-t-0 bg-input-background shadow-[0_20px_24px_-8px_rgba(0,0,0,0.6)] transition-colors duration-200 ease-out motion-reduce:transition-none"
    :class="accented ? 'border-open' : 'border-hairline'"
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
    <!-- biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: combobox listbox -->
    <ul :id="RECENTS_LISTBOX_ID" role="listbox" :aria-label="t('searchRecents.title')">
      <!-- biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: option driven by aria-activedescendant -->
      <li role="option"
        v-for="(item, index) in items"
        :id="recentOptionId(index)"
        :key="item.query"
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
          class="inline-flex max-w-[12rem] flex-shrink-0 items-center truncate rounded-full border border-hairline bg-lift-strong px-2.5 py-0.5 text-xs font-medium text-ink-muted"
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
