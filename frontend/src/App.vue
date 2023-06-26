<script setup>
import { onMounted } from 'vue'
import { initFlowbite } from 'flowbite'
import { RouterLink, RouterView } from 'vue-router'

// initialize components based on data attribute selectors
onMounted(() => {
  initFlowbite()
})
</script>

<template>
  <header></header>

  <RouterView />
</template>
