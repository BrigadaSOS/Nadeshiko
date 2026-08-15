<template>
  <li
    @click="handleClick"
    :aria-current="isActive ? 'true' : undefined"
    class="py-3 px-3 sm:px-5 relative inline-flex items-center gap-2 cursor-pointer shrink-0 text-base sm:gap-2.5"
    :class="isActive
      ? 'font-bold text-[rgb(251,120,120)] after:content-[\'\'] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[#d74e67] after:z-[1]'
      : ''"
  >
    <span class="leading-tight">{{ categoryName }}</span>
    <span class="inline-flex items-center justify-center leading-none min-h-6 bg-gray-100 text-gray-800 text-sm px-2.5 py-1 rounded-lg dark:bg-button-primary-main dark:text-gray-300">
      {{ count }}<span v-if="hasTotal" class="text-gray-500 dark:text-gray-400">/{{ totalCount }}</span>
    </span>
  </li>
</template>

<script setup lang="ts">
const props = defineProps<{
  categoryName?: string;
  count?: number;
  totalCount?: number;
  isActive?: boolean;
}>();
const emit = defineEmits<{
  click: [];
}>();

const hasTotal = computed(() => typeof props.totalCount === 'number' && props.totalCount > (props.count ?? 0));

const handleClick = () => {
  emit('click');
};
</script>
