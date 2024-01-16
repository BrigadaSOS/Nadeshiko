<script setup>
import LanguageSelector from './minimal/LanguageSelector.vue'
import { mdiBookOutline } from '@mdi/js'
import BaseIcon from './minimal/BaseIcon.vue'
import { onMounted, ref, computed } from 'vue'
import router from '../router/index'
import Auth from './auth/LoginSignUp.vue'
import { userStore } from '../stores/user'
const store = userStore()
const isAuth = computed(() => store.isLoggedIn)
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const email = ref('')
let isLoading = ref(false)

let latestVersion = ref('')

import { RouterLink, useRoute } from 'vue-router'

const route = useRoute()

const isActive = (path) => {
  return computed(() => route.path === path)
}

onMounted(async () => {
  getLatestVersion()
  isLoading.value = true
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

const redirectReload = () => {
  router.push({ path: '/' })
}
</script>
<template>
  <Auth />
  <header
    class="flex flex-wrap md:justify-start md:flex-nowrap z-50 w-full bg-white border-b border-gray-200 text-sm py-3 md:py-0 dark:bg-sred  dark:border-gray-700"
  >
    <nav class="relative lg:w-11/12 w-full mx-auto px-4 md:flex md:items-center md:justify-between" aria-label="Global">
      <div class="flex items-center justify-between">
        <img src="../assets/logo.webp" class="h-8 mr-3 rounded-full" alt="Brigada SOS Logo" />
        <router-link to="/" class="flex-none text-base font-semibold dark:text-white" href="#" aria-label="Brand"
          >NadeDB</router-link
        >
        <div class="md:hidden">
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
      <div id="navbar-collapse-with-animation" class="hs-collapse  hidden basis-full grow md:block">
        <div
          class="flex flex-col  gap-y-4 gap-x-0 mt-5 md:flex-row md:items-center md:gap-y-0 md:gap-x-4 md:mt-0 md:pl-10"
        >
        <button
          @click="redirectReload"
          :class="isActive('/').value ? 'border-b-2 font-bold text-white border-white/80': 'bg-transparent text-white'"
          class="font-bold text-white md:py-3 px-4 border-b-2 transition  border-transparent hover:border-white"
        >
          {{t("navbar.buttons.home")}}
        </button>
        <a
          :class="isActive('/discord').value ? 'border-b-2 font-bold text-white border-white/80': 'bg-transparent text-white'"
          class="font-bold text-white md:py-3 px-4 border-b-2 transition  border-transparent hover:border-white"
          href="https://discord.gg/ajWm26ADEj"
        >
          {{t("navbar.buttons.discord")}}
      </a>
      <a
          :class="isActive('/guide').value ? 'border-b-2 font-bold text-white border-white/80': 'bg-transparent text-white'"
          class="font-bold text-white md:py-3 px-4 border-b-2 transition  border-transparent hover:border-white"
          href="https://brigadasos.xyz/"
        >
          {{t("navbar.buttons.guide")}}
        </a>
        <router-link to="/about">
        <button
          :class="isActive('/about').value ? 'border-b-2 font-bold text-white border-white/80': 'bg-transparent text-white'"
          class="font-bold text-white md:py-3 px-4 border-b-2 transition  border-transparent hover:border-white"
        >
          {{t("navbar.buttons.about")}}
        </button>
      </router-link>


  
          <div class="flex flex-col md:py-2 md:flex-row z-50 items-center gap-x-2 md:ml-auto">
            <LanguageSelector class="w-full mb-2 md:mb-0 md:w-auto" />

            <button
              v-if="!isAuth"
              data-hs-overlay="#hs-vertically-centered-scrollable-loginsignup-modal"
              class="dark:bg-sgray w-full md:w-auto outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-200 dark:hover:text-white"
            >
              {{ t("navbar.buttons.login")}}
            </button>

            <div v-else class="hs-dropdown relative inline-flex [--strategy:absolute]">
              <button
                id="hs-dropdown-left-but-right-on-lg"
                type="button"
                class="hs-dropdown-toggle focus:outline-none dark:bg-sgray w-full md:w-auto outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-200 dark:hover:text-white0"
              >
                {{ t("navbar.buttons.profile")}}

                <svg
                  class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-white"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2 5L8.16086 10.6869C8.35239 10.8637 8.64761 10.8637 8.83914 10.6869L15 5"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>

              <div
                class="hs-dropdown-menu w-72 divide-y transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden z-10 top-0 lg:left-auto bg-white shadow-md rounded-lg p-2 mt-2 dark:bg-sgray dark:divide-white/20"
                aria-labelledby="hs-dropdown-left-but-right-on-lg"
              >
                <div class="py-2 first:pt-0 last:pb-0">
                  <router-link
                    to="/account"
                    class="flex items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-white dark:hover:bg-sgray2"
                  >
                    {{ t("navbar.buttons.seeProfile")}}
                  </router-link>
                </div>
                <div class="py-2 first:pt-0 last:pb-0">
                  <a
                    @click="store.logout()"
                    class="flex items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-white dark:hover:bg-sgray2"
                    href="#"
                  >
                    {{ t("navbar.buttons.logout")}}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
    <div class="fixed bottom-0 right-0 text-center z-30">
      <span class="text-base text-white/30 mr-3">{{t("home.version")}}: {{ latestVersion }}</span>
    </div>
  </header>
</template>

<style>
.navbar {
  height: var(3.75rem);
  padding: var(calc(var(--ifm-spacing-vertical) * 0.5)) var(1rem);
}
</style>
