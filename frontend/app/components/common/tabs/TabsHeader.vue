<template>
    <div id="tab-headers" class="w-full overflow-x-auto overflow-y-hidden scrollbar-hide">
      <ul class="tab-titles m-0 p-0 flex list-none flex-nowrap w-full"
          :class="showBorder ? 'border-b-2 border-b-line-subtle' : ''">
        <slot></slot>
      </ul>
    </div>
  </template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    showBorder?: boolean;
  }>(),
  {
    showBorder: true,
  },
);
</script>

<style scoped>
/**
 * The strip scrolls with its scrollbar hidden, so nothing announced that it
 * scrolled -- at 390px "Live Action" and "YouTube" are simply cut off at the
 * edge, reachable but invisible and unadvertised.
 *
 * A fade on the trailing edge is the affordance. When the tabs already fit it
 * falls over empty background and cannot be seen, so it costs nothing on the
 * widths where there is nothing to scroll.
 */
@media (max-width: 767px) {
  #tab-headers {
    mask-image: linear-gradient(to right, #000 calc(100% - 2rem), transparent);
  }
}
</style>
