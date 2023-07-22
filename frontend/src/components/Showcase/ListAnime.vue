<script setup>
import { onMounted, ref } from 'vue'
import { mdiTuneVariant, mdiTextSearch } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'

let latest_anime_list = ref([])

const getLatestAnime = async () => {
  try {
    let response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'search/anime/info', {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    response = await response.json()
    latest_anime_list.value = response.results
  } catch (error) {
    console.log(error)
    return
  }
}

onMounted(() => {
  getLatestAnime()
})
</script>
<template>
  <BatchSearchModal />
  <div class="max-w-[185rem] px-4 sm:px-6 lg:px-0 lg:py-5 mx-auto">
    <!-- Grid -->
    <div class="grid md:grid-cols-7 gap-10">
      <div class="md:col-span-3 rounded-lg">
        <div class="max-w-xl m-4">
          <h2 class="text-3xl font-bold md:text-4xl md:leading-tight dark:text-white">NadeDB</h2>
          <p class="mt-1 text-xl md:block dark:text-white/80">
            Una herramienta para buscar oraciones en japonés desde multiples contextos.
          </p>
          <div
            class="flex flex-col dark:text-white/80 first-letter:items-left px-5 py-4 text-lg mx-auto sm:px-6 lg:px-8"
          >
            <ul class="list-disc">
              <li class="mb-2">
                Busqueda en japonés: <a class="underline text-blue-500 underline-offset-4" href="s">彼女</a>
              </li>
              <li>
                Busqueda en inglés/español:
                <a class="underline text-blue-500 underline-offset-4" href="s">Girlfriend</a>,
                <a class="underline text-blue-500 underline-offset-4" href="s">Novia</a>
              </li>
            </ul>
          </div>
        </div>
        <div class="mb-5 border-b border-white/20" />

        <h2 class="text-2xl m-4 font-bold md:text-xl md:leading-tight dark:text-white">Caracteristícas</h2>
        <div class="grid gap-6 sm:grid-cols-2 text-base mb-8">
          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">Contenido reciente</span>
          </div>

          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">Disponible en inglés y español</span>
          </div>
          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">Descarga de contenido</span>
          </div>
          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">Soporte para unir multiples audios</span>
          </div>
          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">Contexto de una oración</span>
          </div>
          <div class="flex items-center text-gray-800 -px-3 dark:text-gray-200">
            <svg
              class="w-5 h-5 mx-3"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>

            <span class="mx-1">API pública (próximamente)</span>
          </div>
        </div>
        <div class="mb-5 border-b border-white/20" />
        <h2 class="text-2xl m-4 font-bold md:text-xl md:leading-tight dark:text-white">Funcionalidad adicional</h2>

        <button
          type="button"
          @click="showModalBatchSearch"
          data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
          class="py-3.5 duration-300 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
        >
          <BaseIcon :path="mdiTextSearch" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="mr-3" />

          <div class="mr-2">Busqueda simultánea</div>
        </button>
      </div>

      <!-- End Col -->

      <div class="md:col-span-4">
        <!-- Accordion -->
        <section class="w-full rounded-lg">
          <div class="tab-content m-4">
            <div class="inline-flex justify-between items-center w-full mb-4">
              <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">Recién añadido</h1>
              <button
                type="button"
                class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
              >
                Ver todos
                <svg
                  class="w-2.5 h-auto"
                  width="17"
                  height="16"
                  viewBox="0 0 17 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M1 7C0.447715 7 -3.73832e-07 7.44771 -3.49691e-07 8C-3.2555e-07 8.55228 0.447715 9 1 9L13.0858 9L7.79289 14.2929C7.40237 14.6834 7.40237 15.3166 7.79289 15.7071C8.18342 16.0976 8.81658 16.0976 9.20711 15.7071L16.0303 8.88388C16.5185 8.39573 16.5185 7.60427 16.0303 7.11612L9.20711 0.292893C8.81658 -0.0976318 8.18342 -0.0976318 7.79289 0.292893C7.40237 0.683417 7.40237 1.31658 7.79289 1.70711L13.0858 7L1 7Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-x-6 gap-y-3">
              <div v-if="latest_anime_list.length > 0" v-for="(item, index) in latest_anime_list" class="relative">
                <div class="w-full pb-[145%] overflow-hidden relative bg-[rgba(255,255,255,0.1)] block">
                  <img class="w-full h-full object-cover absolute top-0 left-0" :src="item.media_info.cover" />
                </div>

                <div class="mt-2 text-center justify-center flex flex-col items-center">
                  <h3 class="text-sm text-center font-semibold line-clamp-2">{{ item.media_info.english_name }}</h3>
                </div>
                <div class="text-center mt-1 justify-center flex flex-col items-center">
                  <h3 class="text-sm text-center font-medium line-clamp-2">
                    {{ item.total_segments_media }} oraciones
                  </h3>
                </div>
              </div>
              <div v-else role="status" v-for="i in 10" class="animate-pulse relative">
                <div
                  class="w-full pb-[145%] items-center overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"
                ></div>
              </div>
            </div>
          </div>
        </section>

        <!-- End Accordion -->
      </div>
      <!-- End Col -->
    </div>
    <!-- End Grid -->
  </div>
  <!-- End FAQ -->
</template>
