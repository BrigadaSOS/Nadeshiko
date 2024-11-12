<template>
  <button class="flex items-center text-left w-full gap-x-3.5 py-2 px-3 rounded-lg text-sm " :class="buttonClass"
    :disabled="isDisabled">
    <UiBaseIcon v-if="iconPath" :path="iconPath" w="w-5 md:w-5" h="h-5 md:h-5" size="20" />
    {{ text }}
  </button>
</template>

<script setup>
const props = defineProps({
  href: {
    type: String,
    default: '#'
  },
  text: {
    type: String,
    default: 'Item'
  },
  iconPath: {
    type: String,
    default: null
  },
  isDisabled: {
    type: Boolean,
    default: false,
  },
});

const buttonClass = computed(() => {
  if (props.isDisabled) {
    return "px-4 py-2 text-neutral-500 bg-neutral-800 rounded-md opacity-50 cursor-not-allowed";
  }

  return "text-gray-800 dark:text-neutral-400 hover:bg-gray-100 focus:outline-none focus:bg-gray-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300 dark:focus:bg-neutral-700";
});

</script>
