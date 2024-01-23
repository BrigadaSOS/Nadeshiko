<script>
import { RouterView } from 'vue-router'
import { initFlowbite } from 'flowbite'
import { useHead } from '@vueuse/head'
import { computed, reactive } from 'vue'
export default {
  created() {
    const savedLanguage = localStorage.getItem('language')
    if (savedLanguage) {
      this.$i18n.locale = savedLanguage
    }
    initFlowbite()
  },
  setup() {
    const siteDefault = reactive({
      title: 'NadeDB',
      description: 'A powerful tool for searching japanese sentences or words from multiple contexts.'
    })
    useHead({
      title: computed(() => siteDefault.title),
      meta: [
        {
          name: 'description',
          content: computed(() => siteDefault.description)
        }
      ]
    })
  }
}
</script>

<template>
  <header></header>

  <RouterView />
</template>
