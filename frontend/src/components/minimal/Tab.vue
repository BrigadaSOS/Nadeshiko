<script setup>
const props = defineProps({
  title: String,
  amount: Number,
  active: Boolean
});

</script>

<template>
  <div v-show="active" class="tab">
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