<script setup>
import { onMounted } from 'vue'
import { initFlowbite } from 'flowbite'
import { RouterLink, RouterView } from 'vue-router'


// On page load or when changing themes, best to add inline in `head` to avoid FOUC
if (
  localStorage.getItem('color-theme') === 'dark' ||
  (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
) {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}

// initialize components based on data attribute selectors
onMounted(() => {
    initFlowbite();
})

</script>

<template>
  <header></header>

  <RouterView />
</template>
