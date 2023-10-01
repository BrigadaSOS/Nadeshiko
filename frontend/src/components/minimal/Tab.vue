<script setup>
  import { ref, onMounted } from 'vue';
  const props = defineProps([ 'active' ]);
</script>

<template>
  <div class="tab" :class="(active == 'true') ? 'active' : ''" ref="tabs">
    <slot></slot>
  </div>
</template>

<style>
  .tab {
    display: none;
  }
  .tab.active {
    display: block;
  }
</style>