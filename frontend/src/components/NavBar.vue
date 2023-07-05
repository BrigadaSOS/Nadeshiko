<script setup>
import LanguageSelector from './minimal/LanguageSelector.vue'
import { mdiBookOutline } from '@mdi/js'
import BaseIcon from './minimal/BaseIcon.vue'
import { useI18n } from 'vue-i18n'
import { onMounted, ref } from 'vue'
const { t } = useI18n()
let latestVersion = ref('')

onMounted(async () => {
  getLatestVersion()
})

const getLatestVersion = () => {
  const repository = 'BrigadaSOS-db'
  const apiUrl = `https://api.github.com/repos/BrigadaSOS/${repository}/releases/latest`

  fetch(apiUrl)
    .then((response) => response.json())
    .then((data) => {
      latestVersion.value = data.tag_name
    })
    .catch((error) => {
      console.error('Error al obtener la versión más reciente:', error)
    })
}
</script>
<template>
  <header
    class="flex flex-wrap sm:justify-start sm:flex-nowrap z-50 w-full bg-white border-b border-gray-200 text-sm py-3 sm:py-0 dark:bg-sred dark:border-gray-700"
  >
    <nav class="relative lg:w-11/12 w-full mx-auto px-4 sm:flex sm:items-center sm:justify-between" aria-label="Global">
      <div class="flex items-center justify-between">
        <img src="../assets/logo.webp" class="h-8 mr-3 rounded-full" alt="Flowbite Logo" />
        <router-link to="/" class="flex-none text-base font-semibold dark:text-white" href="#" aria-label="Brand"
          >NadeDB</router-link
        >
        <div class="sm:hidden">
          <button
            type="button"
            class="hs-collapse-toggle p-2 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-sred text-gray-700 align-middle hover:bg-sgray focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-gray-700 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-collapse="#navbar-collapse-with-animation"
            aria-controls="navbar-collapse-with-animation"
            aria-label="Toggle navigation"
          >
            <svg class="hs-collapse-open:hidden w-5 h-5" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path
                fill-rule="evenodd"
                d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"
              />
            </svg>
            <svg
              class="hs-collapse-open:block hidden w-5 h-5"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path
                d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"
              />
            </svg>
          </button>
        </div>
      </div>
      <div id="navbar-collapse-with-animation" class="hs-collapse hidden basis-full grow sm:block">
        <div
          class="flex flex-col gap-y-4 gap-x-0 mt-5 sm:flex-row sm:items-center sm:gap-y-0 sm:gap-x-7 sm:mt-0 sm:pl-10"
        >
          <router-link to="/" class="font-bold sm:py-4 dark:text-white" aria-current="page">Inicio</router-link>
          <a class="font-bold text-white/90 hover:text-gray-400 sm:py-5 dark:hover:text-gray-500" href="#">FAQ</a>
          <a class="font-bold text-white/90 hover:text-gray-400 sm:py-5 dark:hover:text-gray-500" href="#">Acerca de</a>
          <a class="font-bold text-white/90 hover:text-gray-400 sm:py-5 dark:hover:text-gray-500" href="#">Discord</a>
          <div class="flex flex-col sm:flex-row z-50 items-center gap-x-2 sm:ml-auto">
            <LanguageSelector class="w-full mb-2 md:mb-0 md:w-auto" />
            <a
              href="https://brigadasos.xyz/"
              class="dark:bg-sgray w-full md:w-auto outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-200 dark:hover:text-white"
            >
              <BaseIcon :path="mdiBookOutline" w="w-10 md:w-5" h="h-10 md:h-5" size="24" class="" />
              {{ t('navbar.buttons.guide') }}
            </a>
          </div>
        </div>
      </div>
    </nav>
    <div class="fixed bottom-0 right-0 text-center z-30">
      <span class=" text-base lg:text-lg text-white/30  mr-3">Versión: {{ latestVersion }}</span>

    </div>
  </header>
</template>

<style>
.navbar {
  height: var(3.75rem);
  padding: var(calc(var(--ifm-spacing-vertical) * 0.5)) var(1rem);
}
</style>
