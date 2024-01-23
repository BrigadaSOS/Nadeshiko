<script>
import { RouterView } from 'vue-router'
import { initFlowbite } from 'flowbite'

export default {
  created() {
    const savedLanguage = localStorage.getItem('language')
    if (savedLanguage) {
      this.$i18n.locale = savedLanguage
    }
    initFlowbite()
  }
}
</script>

<template>
  <header></header>

  <RouterView />
</template>
