<script setup lang="ts">
const props = defineProps<{
  label: string;
  value: number;
  subtitle?: string;
  format?: 'number' | 'decimal';
}>();

const formatted = computed(() => {
  if (props.format === 'decimal') return props.value.toFixed(1);
  return props.value.toLocaleString();
});
</script>

<template>
  <div class="rounded-lg border border-neutral-700 bg-neutral-800/50 p-4">
    <div class="text-sm text-gray-400">{{ label }}</div>
    <div class="text-2xl font-bold text-white mt-1">{{ formatted }}</div>
    <div v-if="subtitle" class="text-xs text-gray-500 mt-1">{{ subtitle }}</div>
  </div>
</template>
