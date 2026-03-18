<script setup lang="ts">
const model = defineModel<number>({ default: 30 });

const options = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];
</script>

<template>
  <div class="flex gap-1">
    <button
      v-for="opt in options"
      :key="opt.value"
      class="px-3 py-1 text-xs rounded-md transition-colors"
      :class="model === opt.value
        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
        : 'bg-neutral-700/50 text-gray-400 border border-transparent hover:bg-neutral-700 hover:text-gray-300'"
      @click="model = opt.value"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
