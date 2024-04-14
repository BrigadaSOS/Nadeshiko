<script setup>
import { onMounted, ref } from 'vue'
import { mdiStarShootingOutline, mdiTextSearch, mdiSync, mdiDownload, mdiHistory, mdiCardMultiple } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'
import AnkiInstallModal from '../AnkiInstallModal.vue'
import Popper from 'vue3-popper'

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

let latest_anime_list = ref([])
let general_stats = ref({})
const base_hover = ref(null)

const getLatestAnime = async () => {
  try {
    let response = await fetch(
      import.meta.env.VITE_APP_BASE_URL_BACKEND +
        'api/search/anime/info?' +
        new URLSearchParams({
          size: 10,
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
    general_stats.value = response.stats
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
  <AnkiInstallModal />
  <div class="w-full pt-4 sm:py-6">
    <section class="flex w-full flex-col items-center">
      <div class="flex flex-col w-11/12 gap-6 lg:gap-16 dark:text-white/80 lg:flex-row">
        <div class="flex-grow">
          <div class="flex rounded-lg flex-col first-letter:items-left">
            <h2
              class="text-3xl ml-2 underline underline-offset-8 decoration-4 decoration-sred sm:mt-0 font-bold md:text-4xl md:leading-tight dark:text-white"
            >
              NadeDB
            </h2>
            <p class="ml-2 pt-5 text-lg">{{ t('home.nadeDbDescription') }}</p>
            <ul class="list-disc ml-8 py-4 font-normal">
              <li class="mb-4">
                {{ t('home.nadeDbDescriptionJpSearch') }}:
                <a class="underline text-blue-400/95 underline-offset-4" href="search/sentences?query=彼女">彼女</a>
              </li>
              <li class="mb-4">
                {{ t('home.nadeDbDescriptionOtherSearch') }}:
                <a class="underline text-blue-400/95 underline-offset-4" href="search/sentences?query=school">School</a
                >,
                <a class="underline text-blue-400/95 underline-offset-4" href="search/sentences?query=escuela"
                  >Escuela</a
                >
              </li>
              <li class="mb-4">
                Busqueda excluyente:
                <a class="underline text-blue-400/95 underline-offset-4" href="search/sentences?query=卒業 -みんな"
                  >卒業 -みんな</a
                >
              </li>
              <li class="">
                Busqueda exacta:
                <a href='search/sentences?query="食べられない"' class="underline text-blue-400/90 underline-offset-4"
                  >"食べられない"</a
                >
              </li>
            </ul>
          </div>

          <div class="border-b pt-2 border-white/10" />

          <div class="my-4 flex font-medium">
            <div class="mr-4">
              <BaseIcon :path="mdiSync" w="w-12 md:w-12" h="h-12 md:h-12" size="30" class="rotate-90" />
            </div>
            <div class="">
              <p class="mb-2">Compatible con Anki</p>
              <span class="font-normal dark:text-white/60"
                >Guarda cualquier oración en Anki incluyendo imagen, audio y múltiples idiomas.</span
              >
            </div>
          </div>

          <div class="mb-5 flex font-medium">
            <div class="mr-4">
              <BaseIcon :path="mdiDownload" w="w-12 md:w-12" h="h-12 md:h-12" size="30" class="" />
            </div>
            <div class="">
              <p class="mb-2">Descarga cualquier oración</p>
              <span class="font-normal dark:text-white/60"
                >Descarga las oraciones en múltiples formatos como imágenes, audios y videos.</span
              >
            </div>
          </div>

          <div class="mb-5 flex font-medium">
            <div class="mr-4">
              <BaseIcon :path="mdiHistory" w="w-12 md:w-12" h="h-12 md:h-12" size="30" class="" />
            </div>
            <div class="">
              <p class="mb-2">Visualiza el contexto de lo que encuentres</p>
              <span class="font-normal dark:text-white/60">Mira lo que ocurrió antes o después de una oración.</span>
            </div>
          </div>

          <div class="mb-5 flex font-medium">
            <div class="mr-4">
              <BaseIcon :path="mdiCardMultiple" w="w-12 md:w-12" h="h-12 md:h-12" size="30" class="" />
            </div>
            <div class="">
              <p class="mb-2">Contenido variado</p>
              <span class="font-normal dark:text-white/60"
                >Disfruta de diferentes generos, diferentes medios, diferentes voces.</span
              >
            </div>
          </div>

          <div class="mb-5 border-b border-white/10" />

          <div class="flex gap-4 text-center">
            <div class="md:w-2/4 sm:w-1/2 w-full">
              <div class="bg-sgray2 border border-sgray border-1 px-4 py-4 rounded-lg">
                <h2 class="title-font font-medium text-3xl text-white">
                  +{{ Math.ceil(general_stats.full_total_segments / 100) * 100 || 0 }}
                </h2>
                <p class="leading-relaxed">
                  {{ t('home.stats.sentenceCount') }}
                </p>
              </div>
            </div>
            <div class="md:w-2/4 sm:w-1/2 w-full">
              <div class="bg-sgray2 border border-sgray border-1 px-4 py-4 rounded-lg">
                <h2 class="title-font font-medium text-3xl text-white">{{ general_stats.full_total_animes || 0 }}</h2>
                <p class="leading-relaxed">
                  {{ t('home.stats.mediaCount') }}
                </p>
              </div>
            </div>
          </div>
          <div class="mt-5 border-b border-white/10" />
        </div>
        <div class="flex-grow lg:max-w-[59rem]">
          <div class="md:col-span-4">
            <section class="w-full rounded-lg">
              <div class="tab-content md:mx-2 flex-grow w-full">
                <div class="inline-flex justify-between items-center w-full mb-4">
                  <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
                    {{ t('animeList.recentlyAddedTitle') }}
                  </h1>
                  <router-link to="/content">
                    <button
                      type="button"
                      class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-lg border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
                    >
                      {{ t('animeList.seeAll') }}
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
                  </router-link>
                </div>

                <div
                  class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-x-6 gap-y-3"
                >
                  <div
                    v-if="latest_anime_list.length > 0"
                    v-for="(media_info, index) in latest_anime_list"
                    class="w-full relative"
                  >
                    <Popper class="w-full" zIndex="50" arrow v-bind="$attrs" hover openDelay="0" closeDelay="100">
                      <div
                        class="border-none pb-[145%] rounded-lg overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"
                      >
                        <img
                          class="w-full h-full object-cover absolute top-0 left-0"
                          :src="media_info.cover + '?width=460&height=652'"
                        />
                        <!-- 
                        <span
                          class="absolute bottom-1 left-1 rounded-lg bg-[#3c1352] text-white font-bold text-xs px-2 py-1"
                        >
                          {{ media_info.airing_format }}
                        </span>
                        -->
                      </div>
                      <template #content>
                        <div class="w-full backdrop-blur-sm bg-sgray2/90 flex flex-col max-w-[400px]">
                          <span
                            class="mx-auto object-center mt-2 text-center px-2 text-lg font-bold text-gray-800 dark:text-white"
                            >{{ media_info.english_name }}</span
                          >
                          <div class="py-3 px-4 text-sm text-gray-600 dark:text-gray-400 min-w-[400px]">
                            <div class="pb-[20%] overflow-hidden relative bg-[rgba(255,255,255,0.1)] block">
                              <img class="object-cover absolute top-0 left-0" :src="media_info.banner" />
                            </div>
                            <div class="mt-3 break-words">
                              <p>
                                <span class="font-bold pt-3 first:pt-0 dark:text-white"
                                  >{{ t('animeList.romajiName') }}:</span
                                >
                                {{ media_info.romaji_name }}
                              </p>
                              <p>
                                <span class="font-bold pt-3 first:pt-0 dark:text-white"
                                  >{{ t('animeList.japaneseName') }}:</span
                                >
                                {{ media_info.japanese_name }}
                              </p>
                              <p>
                                <span class="font-bold pt-3 first:pt-0 dark:text-white"
                                  >{{ t('animeList.seasons') }}:</span
                                >
                                {{ media_info.num_seasons }}
                              </p>
                              <p>
                                <span class="font-bold pt-3 first:pt-0 dark:text-white"
                                  >{{ t('animeList.episodes') }}:
                                </span>
                                {{ media_info.num_episodes }}
                              </p>
                              <p>
                                <span class="font-bold pt-3 first:pt-0 dark:text-white break-words"
                                  >{{ t('animeList.genres') }}:
                                </span>
                                {{ media_info.genres.toString() }}
                              </p>
                            </div>
                          </div>
                        </div>
                      </template>
                    </Popper>

                    <div class="mt-2 text-center justify-center flex flex-col items-center">
                      <h3 class="text-sm text-center font-semibold line-clamp-2">{{ media_info.english_name }}</h3>
                    </div>
                    <div class="text-center mt-1 mb-5 justify-center flex flex-col items-center">
                      <h3 class="text-sm text-center font-medium line-clamp-2">
                        {{ media_info.num_segments }} {{ t('animeList.sentenceCount') }}
                      </h3>
                    </div>
                  </div>
                  <div v-else role="status" v-for="i in 10" class="animate-pulse relative">
                    <div
                      class="w-full pb-[145%] rounded-lg items-center overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"
                    ></div>
                    <div class="mt-2 text-center justify-center flex flex-col items-center">
                      <div class="h-2.5 bg-gray-200 rounded-full dark:bg-sgray w-36 mt-2 mb-4"></div>
                    </div>
                    <div class="text-center mt-1 mb-5 justify-center flex flex-col items-center">
                      <div class="h-2.5 bg-gray-200 rounded-full dark:bg-sgray w-28 mb-4"></div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  </div>

  <div class="w-11/12 mb-14 rounded-lg mx-auto border border-sgray border-1 dark:text-white/80 bg-sgray2 relative">
    <section class="py-6 mx-6">
      <div class="flex mb-4 flex-col md:flex-row justify-top mx-2 md:mx-0">
        <div class="md:flex-1">
          <h2 class="text-2xl font-bold md:text-2xl mb-3 md:leading-tight dark:text-white">¿Te gusta NadeDB?</h2>
          <p class="text-md max-w-2xl text-gray-800 dark:text-gray-200">
            Si encuentras este sitio útil, puedes apoyar nuestro trabajo y su futuro desarrollo con una contribución en
            nuestro Github, una donación o compartiendo este sitio con otras personas.
          </p>
        </div>

        <div class="md:flex-1 mx-2 flex items-center justify-end space-x-4">
          <div class="mt-5 w-auto bg-white p-1 rounded-md">
            <a href="https://github.com/BrigadaSOS">
              <img class="h-10 object-contain" src="../../assets/github.png" alt="GitHub" />
            </a>
          </div>
          <div class="mt-5 w-auto">
            <a href="https://patreon.com/BrigadaSOS">
              <img class="h-12 object-contain rounded-md" src="../../assets/patreon.png" alt="Become a Patron" />
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>

</template>
<style>
:root {
  --popper-theme-background-color-hover: #333333;
  --popper-theme-text-color: #ffffff;
  --popper-theme-border-width: 0px;
  --popper-theme-border-style: solid;
  --popper-theme-border-radius: 6px;
  --popper-theme-padding: 0px;
  --popper-theme-box-shadow: 0 6px 30px -6px rgba(0, 0, 0, 0.25);
}

[data-v-5784ed69].inline-block.w-full {
  border: none !important;
  margin: 0 !important;
}

.b {
  fill: none;
  stroke: #ffffff;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
