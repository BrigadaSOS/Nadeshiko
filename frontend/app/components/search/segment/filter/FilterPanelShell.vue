<script setup lang="ts">
/**
 * The chrome shared by every sidebar filter panel: the bordered card, a centred
 * header with an optional trailing action, an optional fixed area under it (the
 * media search box), and the one scrolling region that holds the rows.
 *
 * The panel owns its height rather than capping it: it fills whatever the
 * sidebar grid or the mobile drawer gives it, and only the row list scrolls.
 * That single scroll region is the point -- a second one nested inside a
 * scrolling drawer is what made the mobile filters unreadable.
 */
withDefaults(
  defineProps<{
    title: string;
    /** Label for the trailing header action; omitted renders no button. */
    actionLabel?: string;
  }>(),
  { actionLabel: undefined },
);

defineEmits<{ action: [] }>();

/**
 * A scrolling list loses width to its scrollbar; the header sits outside it and
 * would otherwise run that much wider, leaving the counts in the header off the
 * column the counts in the rows sit on. Measured rather than assumed: the gutter
 * is 0 on platforms with overlay scrollbars, 0 for a list short enough not to
 * scroll -- which is why it is not reserved up front, so a short list runs the
 * full width of the card -- and ~15px otherwise. The extra 1px in the header's
 * padding is the row border, which insets a row's contents but not the header's.
 */
const scrollRegion = ref<HTMLElement | null>(null);
const scrollbarGutter = ref(0);

const measureGutter = () => {
  const el = scrollRegion.value;
  // getBoundingClientRect over offsetWidth: the latter is rounded to whole
  // pixels, which left the header a pixel off a fractional scrollbar.
  if (el) scrollbarGutter.value = el.getBoundingClientRect().width - el.clientWidth;
};

// The gutter now comes and goes with the rows, so a window resize listener is
// not enough: the observer fires on the content box, which is exactly what a
// scrollbar appearing or disappearing changes.
let observer: ResizeObserver | null = null;

onMounted(() => {
  measureGutter();
  if (scrollRegion.value) {
    observer = new ResizeObserver(measureGutter);
    observer.observe(scrollRegion.value);
  }
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div class="relative mx-auto w-full flex flex-col flex-1 min-h-0">
    <ul
      class="z-20 divide-y divide-white/5 dark:border-white/5 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 rounded-lg overflow-hidden dark:bg-button-primary-main border dark:text-white flex flex-col flex-1 min-h-0">
      <div
        class="flex items-center w-full px-4 py-2 text-center rounded-t-lg rounded-l-lg shrink-0"
        :style="{ paddingRight: `calc(1rem + ${scrollbarGutter}px + 1px)` }">
        <!-- The header is a slot as well as a title so the episode level can put
             its back row here and still line up with the titles level. -->
        <slot name="header">
          <span class="font-medium text-sm flex-1 text-center">{{ title }}</span>
        </slot>
        <button
          v-if="actionLabel"
          type="button"
          @click="$emit('action')"
          :style="{ right: `calc(1rem + ${scrollbarGutter}px + 1px)` }"
          class="text-xs text-gray-400 hover:text-gray-200 dark:hover:text-white absolute right-4">
          {{ actionLabel }}
        </button>
      </div>

      <slot name="subheader" />

      <div ref="scrollRegion" class="overflow-y-auto overscroll-y-none flex-1 min-h-0">
        <slot />
      </div>
    </ul>
  </div>
</template>
