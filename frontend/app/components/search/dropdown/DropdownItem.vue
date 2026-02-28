<template>
  <div class="relative group/tooltip">
    <button class="flex items-center text-left w-full gap-x-3.5 py-2 px-3 rounded-lg text-sm " :class="buttonClass"
      :disabled="isDisabled">
      <UiBaseIcon v-if="iconPath" :path="iconPath" w="w-5 md:w-5" h="h-5 md:h-5" size="20" />
      {{ text }}
    </button>
    <div
      v-if="tooltip && isDisabled"
      class="hidden md:group-hover/tooltip:block absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-1.5 text-xs text-white bg-neutral-950 rounded-md shadow-lg whitespace-nowrap pointer-events-none ring-1 ring-neutral-700"
    >
      {{ tooltip }}
      <div class="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-neutral-950"></div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  href: {
    type: String,
    default: '#',
  },
  text: {
    type: String,
    default: 'Item',
  },
  iconPath: {
    type: String,
    default: null,
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
  tooltip: {
    type: String,
    default: null,
  },
});

const buttonClass = computed(() => {
  if (props.isDisabled) {
    return 'px-4 py-2 text-neutral-500 bg-neutral-800 rounded-md opacity-50 cursor-not-allowed';
  }

  return 'text-gray-800 dark:text-neutral-400 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300 dark:focus:bg-neutral-700';
});
</script>
