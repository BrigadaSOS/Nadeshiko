<script setup>
import { computed } from "vue";
const props = defineProps({
  path: {
    type: String,
    required: false,
  },
  w: {
    type: String,
    default: "w-6",
  },
  h: {
    type: String,
    default: "h-6",
  },
  size: {
    type: [String, Number],
    default: null,
  },
  display: {
    type: String,
    default: "inline-flex"
  },
  fill: {
    type: String,
    default: "currentColor"
  },
  strokewidth: {
    type: String,
    default: ""
  },
  verticalAlign: {
    type: String,
    default: "middle"
  },
  stroke: {
    type: String,
    default: ""
  }
});
const spanClass = computed(
  () => `${props.display} justify-center items-center ${props.w} ${props.h}`
);
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
      <path :fill=fill :d="path" :stroke-width=strokewidth :stroke="stroke" />
    </svg>
    <slot />
  </span>
</template>