<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    borderless?: boolean;
    segmentHoverBorder?: boolean;
  }>(),
  { borderless: false, segmentHoverBorder: false },
);
</script>

<template>
    <button
        type="button"
        class="inline-flex items-center gap-x-2 px-3 py-1.5 text-sm font-semibold rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-button-primary-main dark:hover:bg-button-primary-hover dark:text-neutral-400 dark:hover:text-neutral-300"
        :class="props.segmentHoverBorder ? 'border border-transparent group-hover:border-hairline' : props.borderless ? undefined : 'border border-hairline'"
    >
    <slot></slot>
    </button>
</template>
