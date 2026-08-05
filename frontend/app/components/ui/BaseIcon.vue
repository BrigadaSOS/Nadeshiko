<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(
  defineProps<{
    path?: string;
    w?: string;
    h?: string;
    size?: string | number | null;
    display?: string;
    fill?: string;
    strokewidth?: string;
    verticalAlign?: string;
    stroke?: string;
  }>(),
  {
    w: 'w-6',
    h: 'h-6',
    size: null,
    display: 'inline-flex',
    fill: 'currentColor',
    strokewidth: '',
    verticalAlign: 'middle',
    stroke: '',
  },
);
const spanClass = computed(() => `${props.display} justify-center items-center ${props.w} ${props.h}`);
const iconSize = computed(() => props.size ?? 16);
</script>
<template>
  <span  :class="spanClass">
    <svg
      viewBox="0 0 24 24"
      :width="iconSize"
      :height="iconSize"
      class="inline-block"
      :style="{verticalAlign: props.verticalAlign}"
    >
      <path :fill="fill" :d="path" :stroke-width="strokewidth || undefined" :stroke="stroke || undefined" />
    </svg>
    <slot />
  </span>
</template>