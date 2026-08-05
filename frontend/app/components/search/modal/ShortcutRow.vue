<script setup lang="ts">
defineProps<{
  keys: string[];
  description: string;
}>();
</script>

<template>
  <div class="flex items-center justify-between">
    <span class="text-sm text-gray-300">{{ description }}</span>
    <div class="flex items-center gap-1">
      <template v-for="(key, i) in keys" :key="i">
        <kbd
          class="min-h-[26px] min-w-[26px] inline-flex justify-center items-center px-1.5 py-0.5 bg-neutral-800 border border-neutral-700 font-mono text-xs text-neutral-300 rounded-md">
          {{ key }}
        </kbd>
        <span v-if="i < keys.length - 1" class="text-gray-500 text-xs">+</span>
      </template>
    </div>
  </div>
</template>
