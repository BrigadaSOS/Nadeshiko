<script setup>
import { onMounted, ref } from 'vue'
import { mdiArrowRight, mdiTextSearch } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'
import Popper from 'vue3-popper'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

let latest_anime_list = ref([])
const base_hover = ref(null)

const getLatestAnime = async () => {
  try {
    let response = await fetch(
      import.meta.env.VITE_APP_BASE_URL_BACKEND +
        'api/search/anime/info?' +
        new URLSearchParams({
          sorted: true
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
    console.log(base_hover)
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
  <section class="w-full p-1 rounded-lg">
    <div class="tab-content md:mx-16 mt-6">
      <div class="inline-flex justify-between items-center w-full">
        <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
          {{ t('animeList.fullListTitle') }}
        </h1>
      </div>

      <div v-if="latest_anime_list.length > 0" v-for="(media_info, index) in latest_anime_list" class="w-full relative">
        <div
          class="flex bg-white rounded-lg dark:bg-sgray2/100 hover:dark:bg-sgray2/90 transition-all dark:border-white/10 border my-6"
        >
          <img :src="media_info.banner" class="absolute inset-0 object-cover w-full h-full -z-10 rounded-lg" />

          <div class="relative flex-none w-56 h-80">
            <img :src="media_info.cover" class="absolute inset-0 object-cover w-full h-full rounded-lg" />
          </div>
          <div class="flex-auto p-6">
            <div class="flex flex-wrap">
              <h1 class="flex-auto text-xl font-semibold dark:text-gray-50">
                {{ media_info.english_name }}
              </h1>
              <div class="text-lg font-semibold bg-gray-500 px-2 rounded-xl text-white">Anime</div>
              <div class="flex-none w-full mt-2 text-sm font-medium text-gray-500 dark:text-gray-300">
                {{ media_info.japanese_name }} - {{ media_info.romaji_name }}
              </div>
            </div>

            <div
              class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
            ></div>

            <div class="grid grid-cols-2 mt-2">
              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">
                Cantidad de Oraciones: {{ media_info.num_segments }}
              </p>

              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">Cantidad de Palabras:</p>
              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">Palabras Únicas:</p>
              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">Kanjis Únicos:</p>
              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">
                Palabras Únicas (usadas una vez):
              </p>
              <p class="text-sm my-1 shadow font-semibold text-gray-500 dark:text-gray-300">
                Índice de Diversidad Léxica:
              </p>
            </div>

            <div class="flex absolute bottom-8">
              <div class="flex">
                <div class="flex flex-row bg-white border shadow-sm rounded-xl dark:bg-graypalid dark:border-gray-800">
                  <div class="px-2 py-2 text-center">
                    <div class="flex items-center gap-x-2">
                      <p class="text-xs uppercase tracking-wide text-white">Temporadas:</p>
                      <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_seasons }}</p>
                    </div>
                  </div>
                </div>

                <div class="flex flex-row bg-white border shadow-sm rounded-xl dark:bg-graypalid dark:border-gray-800">
                  <div class="px-2 py-2 text-center">
                    <div class="flex items-center gap-x-2">
                      <p class="text-xs uppercase tracking-wide text-white">Episodios:</p>
                      <p class="text-xs font-medium text-gray-800 dark:text-gray-200">{{ media_info.num_episodes }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="mt-2 py-2 flex items-center text-sm text-gray-800 gap-x-1.5 after:flex-[1_1_0%] after:border-t after:border-gray-200 after:ms-0 dark:text-white dark:after:border-white/20"
            ></div>

            <div class="flex absolute bottom-0 right-4">
              <button
                type="button"
                data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
                class="py-3.5 ml-auto duration-300 px-4 mb-4 inline-flex justify-center items-center gap-2 border font-medium shadow-sm align-middle  transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:border-blue-400 dark:placeholder-gray-400 dark:text-blue-400"
              >
                <div class="">Detalles</div>
                <BaseIcon :path="mdiArrowRight" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
<style>

</style>
