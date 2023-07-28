<script setup>
import { onMounted, ref } from 'vue'
import { mdiStarShootingOutline, mdiTextSearch } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'
import Popper from 'vue3-popper'

let latest_anime_list = ref([])
const base_hover = ref(null)

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
      <div class="inline-flex justify-between items-center w-full mb-4">
        <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">Listado de animes</h1>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-3 mt-2 mb-8">
        <div v-if="latest_anime_list.length > 0" v-for="(item, index) in latest_anime_list" class="w-full relative">
          <Popper class="w-full" zIndex="50" arrow v-bind="$attrs" hover openDelay="0" closeDelay="0">
            <div class="border-none pb-[145%] rounded-md overflow-hidden relative bg-[rgba(255,255,255,0.1)] block">
              <img
                class="w-full h-full object-cover absolute top-0 left-0"
                :src="item.media_info.cover"
              />
            </div>

            <template #content>
              <div class="w-full backdrop-blur-sm bg-sgray2/90 flex flex-col max-w-[400px]">
                <span
                  class="mx-auto object-center mt-2 text-center px-2 text-lg font-bold text-gray-800 dark:text-white"
                  >{{ item.media_info.english_name }}</span
                >
                <div class="py-3 px-4 text-sm text-gray-600 dark:text-gray-400 min-w-[400px]">
                  <div class="pb-[20%] overflow-hidden relative bg-[rgba(255,255,255,0.1)] block">
                    <img class="object-cover absolute top-0 left-0" :src="item.media_info.banner" />
                  </div>
                  <div class="mt-3 break-words">
                    <p>
                      <span class="font-bold pt-3 first:pt-0 dark:text-white">Nombre en romaji: </span>
                      {{ item.media_info.romaji_name }}
                    </p>
                    <p>
                      <span class="font-bold pt-3 first:pt-0 dark:text-white">Nombre en japonés: </span>
                      {{ item.media_info.japanese_name }}
                    </p>
                    <p>
                      <span class="font-bold pt-3 first:pt-0 dark:text-white">Temporadas: </span>
                      {{item.media_info.num_seasons}}
                    </p>
                    <p>
                      <span class="font-bold pt-3 first:pt-0 dark:text-white">Episodios: </span>
                      {{item.media_info.num_episodes}}
                    </p>
                    <p>
                      <span class="font-bold pt-3 first:pt-0 dark:text-white break-words">Generos: </span>
                      {{ item.media_info.genres.toString() }}
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </Popper>

          <div class="mt-2 text-center justify-center flex flex-col items-center">
            <h3 class="text-sm text-center font-semibold line-clamp-2">{{ item.media_info.english_name }}</h3>
          </div>
          <div class="text-center mt-1 justify-center flex flex-col items-center">
            <h3 class="text-sm text-center font-medium line-clamp-2">{{ item.media_info.num_segments }} oraciones</h3>
          </div>
        </div>
        <div v-else role="status" v-for="i in 10" class="animate-pulse relative">
          <div class="w-full pb-[145%] items-center overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"></div>
        </div>
      </div>
    </div>
  </section>
</template>
