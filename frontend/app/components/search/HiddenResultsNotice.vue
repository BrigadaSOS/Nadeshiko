<script setup lang="ts">
/**
 * The line above the results that accounts for what the reader's own hidden
 * media and hidden categories are keeping out of them, and offers the ways out:
 * ask which titles those are, see them once, or go change the list.
 *
 * The breakdown is behind a click, never in the line itself. Hiding a show is
 * mostly a spoiler tool, so naming one in a notice the reader never asked for
 * would undo the reason it was hidden -- opening the popover is the reader
 * saying they want to know.
 */
import { mdiEyeOff } from '@mdi/js';
import type { HiddenBreakdownRow } from '~/utils/hiddenResults';

defineProps<{
  /**
   * Hits kept out of the list, or 0 when the payload no longer carries enough to
   * count them -- an excluded category bucket comes back dropped rather than
   * emptied, so a search hidden down to nothing has a number nobody can state.
   */
  count: number;
  /** The reader has lifted their filters for this search. */
  revealed: boolean;
  /** Fetched on first open, so the closed notice costs no request. */
  breakdown: HiddenBreakdownRow[] | null;
  breakdownLoading: boolean;
  breakdownError: boolean;
}>();

defineEmits<{ reveal: []; restore: []; breakdown: []; manage: [] }>();

const localePath = useLocalePath();
</script>

<template>
  <div
    data-testid="hidden-results-notice"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 md:px-0 py-2.5 text-sm text-white/45">
    <UiBaseIcon :path="mdiEyeOff" size="16" class="shrink-0" />

    <span v-if="revealed">{{ $t('searchContainer.hiddenResultsRevealed') }}</span>

    <!-- The reason is the link: "hidden by your filters" says which filters when
         asked, rather than parking a second control at the end of the line. -->
    <!-- Teleported so the panel is placed against the VIEWPORT rather than
         against the trigger's left edge. `max-w` capped the width but not the
         position: the trigger is the last words of a sentence, so on a phone it
         starts near the right margin and even a capped panel hung off the screen
         from there. `placeDropdownMenu` clamps it back inside. -->
    <SearchDropdownContainer
      v-else
      dropdownId="nd-hidden-results"
      teleport
      dropdown-container-class="z-50 w-72 max-w-[calc(100vw-2rem)] p-3">
      <template #default="{ toggle, isOpen }">
        <span class="inline-flex flex-wrap items-center gap-x-1">
          <i18n-t
            :keypath="count > 0 ? 'searchContainer.hiddenResults' : 'searchContainer.hiddenResultsMaybe'"
            :plural="count"
            tag="span"
            scope="global">
            <template #count>{{ count }}</template>
            <template #filters>
              <button
                type="button"
                data-testid="hidden-results-breakdown-trigger"
                :aria-expanded="isOpen"
                class="underline decoration-dotted underline-offset-2 hover:text-white/80 transition-colors"
                @click="toggle(); $emit('breakdown')">
                {{ $t('searchContainer.hiddenResultsFilters') }}
              </button>
            </template>
          </i18n-t>
        </span>
      </template>

      <template #content>
        <p class="text-xs font-medium text-ink mb-2">{{ $t('searchContainer.hiddenResultsBreakdownTitle') }}</p>

        <p v-if="breakdownLoading" class="text-xs text-ink-faint">
          {{ $t('searchContainer.hiddenResultsBreakdownLoading') }}
        </p>
        <p v-else-if="breakdownError" class="text-xs text-red-400">
          {{ $t('searchContainer.hiddenResultsBreakdownError') }}
        </p>
        <p v-else-if="!breakdown?.length" class="text-xs text-ink-faint">
          {{ $t('searchContainer.hiddenResultsBreakdownEmpty') }}
        </p>
        <ul v-else data-testid="hidden-results-breakdown" class="max-h-64 overflow-auto -mx-1">
          <li
            v-for="row in breakdown"
            :key="row.name"
            class="flex items-center gap-3 px-1 py-1.5 text-xs text-ink-muted">
            <span class="flex-1 min-w-0 break-words">{{ row.name }}</span>
            <span class="shrink-0 bg-control text-ink rounded-lg px-2 py-0.5">{{ row.count }}</span>
          </li>
        </ul>
      </template>
    </SearchDropdownContainer>

    <button
      type="button"
      data-testid="hidden-results-toggle"
      class="font-medium text-white/70 hover:text-white underline underline-offset-2 transition-colors"
      @click="revealed ? $emit('restore') : $emit('reveal')">
      {{ revealed ? $t('searchContainer.hiddenResultsRestore') : $t('searchContainer.hiddenResultsShow') }}
    </button>

    <span aria-hidden="true" class="text-white/20">·</span>

    <NuxtLink
      :to="localePath('/user/media')"
      class="font-medium text-white/70 hover:text-white underline underline-offset-2 transition-colors"
      @click="$emit('manage')">
      {{ $t('searchContainer.hiddenResultsManage') }}
    </NuxtLink>
  </div>
</template>
