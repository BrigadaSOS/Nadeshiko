<script setup>
import { onMounted, ref, computed } from 'vue'
import { mdiArrowRight, mdiTextSearch } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'
import Popper from 'vue3-popper'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

let latest_anime_list = ref([])
const base_hover = ref(null)

const isLoading = ref(false)
const error_connection = ref(false)

const currentPage = ref(1)
const pageSize = ref(50)
const totalItems = ref(0)

const getLatestAnime = async (page = currentPage.value) => {
  isLoading.value = true
  try {
    let response = await fetch(
      `${import.meta.env.VITE_APP_BASE_URL_BACKEND}search/media/info?` +
        new URLSearchParams({
          sorted: 'true',
          page: page.toString(),
          size: pageSize.value.toString()
        }),
      {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
    response = await response.json()
    latest_anime_list.value = response.results
    totalItems.value = response.stats.full_total_animes
    isLoading.value = false
  } catch (error) {
    console.error(error)
    isLoading.value = false
    error_connection.value = true
  }
}

const totalPages = computed(() => Math.ceil(totalItems.value / pageSize.value))

const showPrevPageButton = computed(() => currentPage.value > 1)
const showNextPageButton = computed(() => currentPage.value < totalPages.value)

const nextPage = () => {
  currentPage.value++
  getLatestAnime()
}

const prevPage = () => {
  currentPage.value = Math.max(1, currentPage.value - 1)
  getLatestAnime()
}

onMounted(() => {
  getLatestAnime()
})
</script>
<template>
  <section class="lg:w-11/12 mx-auto">
    <div class="tab-content mt-6">
      <div class="inline-flex justify-between items-center w-full">
        <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
          {{ t('animeList.fullListTitle') }}
        </h1>
      </div>

      <div class="sticky z-30 top-0" id="search-bar" ref="searchBar">
        <form @submit="searchHandler">
          <label
            for="default-search"
            class="mb-2 text-sm xxl:text-base xxm:text-2xl font-medium z-30 text-gray-900 sr-only dark:text-white"
            >{{ t('searchpage.main.buttons.search') }}</label
          >
          <div class="relative mx-auto mt-4">
            <div class="flex">
              <div class="absolute inset-y-0 left-0 flex items-center justify-center pl-3 pointer-events-none">
                <div
                  v-if="
                    (!isLoading && error_connection === true) ||
                    error_connection === true ||
                    (!isLoading && error_connection === false)
                  "
                >
                  <svg
                    aria-hidden="true"
                    class="w-5 h-5 text-gray-500 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    ></path>
                  </svg>
                </div>
                <div v-else-if="isLoading && error_connection === false">
                  <span
                    class="animate-spin inline-block mt-1 w-4 h-4 border-[3px] border-current border-t-transparent text-white rounded-full"
                    role="status"
                    aria-label="loading"
                  >
                    <span class="sr-only">Loading...</span>
                  </span>
                </div>
              </div>
              <div class="flex flex-1">
                <textarea
                  v-model="querySearch"
                  type="search"
                  id="default-search"
                  autocomplete="off"
                  autocorrect="off"
                  autofocus
                  rows="1"
                  class="block w-full p-4 resize-none pl-10 text-sm h-[55px] text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
                  placeholder="Busca aquí..."
                  required
                  @keydown.enter="searchHandler"
                />
              </div>
              <button
                type="submit"
                class="text-white absolute right-2.5 bottom-2.5 bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-4 py-2 dark:bg-graypalid dark:hover:bg-gray-500 dark:focus:ring-blue-800"
              >
                {{ t('searchpage.main.buttons.search') }}
              </button>
            </div>
          </div>
        </form>
      </div>

      <div v-if="latest_anime_list.length > 0" v-for="(media_info, index) in latest_anime_list" :key="media_info.id" class="w-full relative">
        <div
          class="flex flex-col items-center sm:items-start sm:flex-row bg-white rounded-lg dark:bg-sgray2/90 hover:dark:bg-sgray2/90 transition-all dark:border-white/10 border my-6"
        >
          <img :src="media_info.banner" class="absolute inset-0 object-cover w-full h-full -z-10 rounded-lg" />

          <div class="relative flex-none w-[16em] h-[21em]">
            <img :src="media_info.cover" class="absolute inset-0 object-cover w-full h-full rounded-lg" />
          </div>
          <div class="flex-auto p-6">
            <div class="flex flex-wrap">
              <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                {{ media_info.english_name }}
              </h1>
              <div
                class="text-lg font-semibold bg-graypalid px-3 rounded-lg dark:bg-graypalid dark:border-sgray2 text-white"
              >
                Anime
              </div>
              <div class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300">
                {{ media_info.japanese_name }} - {{ media_info.romaji_name }}
              </div>
            </div>

            <div
              class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
            ></div>

            <div class="grid grid-cols-2 mt-2">
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">
                Cantidad de Oraciones: {{ media_info.num_segments }}
              </p>

              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Cantidad de Palabras:</p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Palabras Únicas:</p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Kanjis Únicos:</p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">
                Palabras Únicas (usadas una vez):
              </p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Índice de Diversidad Léxica:</p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Puntaje Anilist:</p>
              <p class="text-sm my-1 font-semibold text-gray-500 dark:text-gray-300">Dificultad:</p>
            </div>

            <div
              class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
            ></div>

            <div class="flex mt-2 items-center flex-wrap">
              <div
                class="flex h-8 flex-row grow-0 bg-white border mr-2 shadow-sm rounded-xl dark:bg-graypalid dark:border-sgray2"
              >
                <div class="px-2 py-2 text-center">
                  <div class="flex items-center gap-x-2">
                    <p class="text-xs uppercase tracking-wide text-white">Temporadas:</p>
                    <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_seasons }}</p>
                  </div>
                </div>
              </div>

              <div class="flex h-8 flex-row bg-white border shadow-sm rounded-xl dark:bg-graypalid dark:border-sgray2">
                <div class="px-2 py-2 text-center">
                  <div class="flex items-center gap-x-2">
                    <p class="text-xs uppercase tracking-wide text-white">Episodios:</p>
                    <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_episodes }}</p>
                  </div>
                </div>
              </div>

              <div class="ml-auto mt-4 md:mt-1 flex">
                <button
                  type="button"
                  data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
                  class="py-3.5 mr-3 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-white/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-white dark:placeholder-gray-400 dark:text-white"
                >
                  <div>Anilist</div>
                </button>

                <button
                  type="button"
                  data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
                  class="py-3.5 duration-300 px-4 h-12 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle transition-all text-sm dark:hover:bg-blue-500/10 text-gray-900 rounded-lg focus:border-red-500 dark:border-blue-400 dark:placeholder-gray-400 dark:text-blue-400"
                >
                  <div>Vocabulario</div>
                  <BaseIcon :path="mdiArrowRight" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-1 mb-10">
        <button v-if="showPrevPageButton" @click="prevPage" class="mr-auto border-b-2 border-sred p-2">
          Página Anterior
        </button>
        <button v-if="showNextPageButton" @click="nextPage" class="ml-auto border-b-2 border-sred p-2">
          Página Siguiente
        </button>
      </div>
    </div>
  </section>
</template>
<style></style>
