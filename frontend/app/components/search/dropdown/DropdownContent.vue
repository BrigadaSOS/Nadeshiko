<template>
  <div>
    <p v-if="header" class="nd-menu-header">{{ header }}</p>
    <div class="w-full">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  header?: string;
}>();
</script>
