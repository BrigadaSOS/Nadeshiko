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
/** The scrollbar is hidden; a trailing fade advertises overflow and disappears over empty space when tabs fit. */
@media (max-width: 767px) {
  #tab-headers {
    mask-image: linear-gradient(to right, #000 calc(100% - 2rem), transparent);
  }
}
</style>
