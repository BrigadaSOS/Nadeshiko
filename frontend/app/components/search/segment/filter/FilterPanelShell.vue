<script setup lang="ts">
/**
 * The chrome shared by every sidebar filter panel: optional controls above
 * the card (sort), the bordered card itself (title search and rows), an
 * optional header (the episode back row), and the one scrolling region that
 * holds the rows.
 *
 * Height is a cap, not a fill: a short list stays the height of its rows, and
 * a long one shrinks to whatever the sidebar grid or the mobile drawer has left
 * (`min-h-0`) so only the row list scrolls. Growing to fill was stretching an
 * empty card down the side of a ten-title search.
 */
withDefaults(
  defineProps<{
    /** Square, edge-to-edge — the mobile drawer, whose own chrome is already the frame. */
    flush?: boolean;
  }>(),
  { flush: false },
);

/**
 * A scrolling list loses width to its scrollbar; the header sits outside it and
 * would otherwise run that much wider, leaving the counts in the header off the
 * column the counts in the rows sit on. Measured rather than assumed: the gutter
 * is 0 on platforms with overlay scrollbars, 0 for a list short enough not to
 * scroll -- which is why it is not reserved up front, so a short list runs the
 * full width of the card -- and ~15px otherwise.
 */
const scrollRegion = ref<HTMLElement | null>(null);
const scrollbarGutter = ref(0);

const measureGutter = () => {
  const el = scrollRegion.value;
  // getBoundingClientRect over offsetWidth: the latter is rounded to whole
  // pixels, which left the header a pixel off a fractional scrollbar. Clamped
  // because the two widths disagree by a sub-pixel fraction even with no
  // scrollbar in play -- measured at -0.11px on a live panel -- and a negative
  // gutter would pull the header in rather than leave it where the rows are.
  if (el) scrollbarGutter.value = Math.max(0, el.getBoundingClientRect().width - el.clientWidth);
};

// The gutter now comes and goes with the rows, so a window resize listener is
// not enough: the observer fires on the content box, which is exactly what a
// scrollbar appearing or disappearing changes.
let observer: ResizeObserver | null = null;
let pendingMeasure: number | null = null;

/**
 * The measurement happens on the NEXT frame, never inside the observer callback.
 *
 * Writing a reactive value from the callback re-renders the panel while the
 * browser is still delivering resize notifications, and the browser reports
 * that as an unhandled `ResizeObserver loop completed with undelivered
 * notifications`. That reached error tracking from real sessions the night the
 * panel shipped -- always on an episode-level panel, the only level whose
 * header consumes the gutter.
 *
 * Coalesced, so a burst of resizes in one frame measures once.
 */
const scheduleMeasure = () => {
  if (pendingMeasure !== null) return;
  pendingMeasure = requestAnimationFrame(() => {
    pendingMeasure = null;
    measureGutter();
  });
};

onMounted(() => {
  measureGutter();
  if (scrollRegion.value) {
    observer = new ResizeObserver(scheduleMeasure);
    observer.observe(scrollRegion.value);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  if (pendingMeasure !== null) cancelAnimationFrame(pendingMeasure);
});
</script>

<template>
  <!-- `min-w-0` for the same reason as `min-h-0`, on the other axis: the panel
       is a grid item in the sidebar, and a grid item refuses to be narrower
       than its min-content width. The header's title is `truncate`, but
       `overflow: hidden` only zeroes the AUTOMATIC minimum size -- it leaves
       the nowrap text's min-content width intact, so a long title pushed the
       whole card out past the sidebar column and off the page. -->
  <div class="relative w-full min-w-0 flex flex-col flex-1 min-h-0">
    <!-- Sort is a separate action; the title search is part of the list card. -->
    <div
      v-if="$slots.before"
      class="shrink-0 w-full mb-3 flex flex-col gap-3 text-sm"
      :class="flush ? 'px-4 pt-3' : ''">
      <slot name="before" />
    </div>
    <ul
      class="z-20 text-sm xxl:text-base xxm:text-2xl font-medium overflow-hidden bg-button-primary-main text-ink flex flex-col flex-1 min-h-0"
      :class="flush ? 'rounded-none border-0' : 'rounded-lg border border-hairline'">
      <template v-if="$slots.subheader">
        <div class="shrink-0 p-4">
          <slot name="subheader" />
        </div>
        <div class="shrink-0 mx-5 border-t border-line-subtle" aria-hidden="true" />
      </template>
      <div v-if="$slots.header" class="shrink-0 mx-5 border-t border-line-subtle" aria-hidden="true" />
      <div
        v-if="$slots.header"
        class="shrink-0 flex items-center w-full px-5 py-2.5 text-center bg-sgrayhover"
        :style="{ paddingRight: `calc(1rem + ${scrollbarGutter}px)` }">
        <slot name="header" />
      </div>
      <!-- The first list row deliberately has no top rule. The selected title
           header supplies both boundaries, matching the list's inset rules. -->
      <div v-if="$slots.header" class="shrink-0 mx-5 border-t border-line-subtle" aria-hidden="true" />

      <div ref="scrollRegion" class="overflow-y-auto overscroll-y-none flex-1 min-h-0">
        <slot />
      </div>
    </ul>
  </div>
</template>
