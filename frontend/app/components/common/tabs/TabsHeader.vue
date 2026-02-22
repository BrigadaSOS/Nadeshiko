<template>
    <div id="tab-headers" class="w-full overflow-x-auto overflow-y-hidden">
      <ul class="tab-titles m-0 p-0 flex list-none flex-nowrap w-full"
          :class="showBorder ? 'border-b-2 border-[#dddddd21]' : ''">
        <slot></slot>
      </ul>
    </div>
  </template>

  <script setup>
defineProps({
  showBorder: {
    type: Boolean,
    default: true,
  },
});
</script>
