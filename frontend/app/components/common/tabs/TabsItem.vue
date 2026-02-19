<template>
  <li
    @click="handleClick"
    class="py-4 px-5 relative inline-flex items-center gap-2.5 cursor-pointer shrink-0"
    :class="isActive
      ? 'font-bold text-[rgb(251,120,120)] after:content-[\'\'] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#d74e67] after:z-[1]'
      : ''"
  >
    <span class="leading-tight">{{ categoryName }}</span>
    <span class="inline-flex items-center justify-center leading-none min-h-6 bg-gray-100 text-gray-800 text-sm px-2.5 py-1 rounded-lg dark:bg-button-primary-main dark:text-gray-300">
      {{ count }}
    </span>
  </li>
</template>

<script setup>
defineProps(['categoryName', 'count', 'isActive']);
const emit = defineEmits(['click']);

const handleClick = () => {
  emit('click');
};
</script>
