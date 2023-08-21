<script setup>
import { onMounted, ref } from 'vue'
import { mdiStarShootingOutline, mdiTextSearch } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import BatchSearchModal from '../BatchSearchModal.vue'
import Popper from 'vue3-popper'
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

let latest_anime_list = ref([])
let general_stats = ref({})
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
    latest_anime_list.value = Object.values(response.results).slice(0, 15)
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
  <BatchSearchModal />
  <div class="max-w-[185rem] px-4 sm:px-6 lg:px-0 lg:py-5 ">
    <!-- Grid -->
    <div class="grid md:grid-cols-7 gap-10 mb-5 lg:mb-0">
      <div class="md:col-span-3 rounded-lg">
        <div class="max-w-xl m-4">
          <h2 class="text-3xl font-bold md:text-4xl md:leading-tight dark:text-white">NadeDB</h2>
          <p class="mt-1 text-xl md:block dark:text-white/80">
            {{t("home.nadeDbDescription")}}
          </p>
          <div
            class="flex flex-col dark:text-white/80 first-letter:items-left px-5 py-4 text-lg mx-auto sm:px-6 lg:px-8"
          >
            <ul class="list-disc">
              <li class="mb-2">
                {{t("home.nadeDbDescriptionJpSearch")}}: <a class="underline text-blue-500 underline-offset-4" href="search/sentences?query=彼女">彼女</a>
              </li>
              <li>
                {{t("home.nadeDbDescriptionOtherSearch")}}:
                <a class="underline text-blue-500 underline-offset-4" href="search/sentences?query=Girlfriend">Girlfriend</a>,
                <a class="underline text-blue-500 underline-offset-4" href="search/sentences?query=Novia">Novia</a>
              </li>
            </ul>
          </div>
        </div>
        <div class="mb-5 border-b border-white/20" />
        <h2 class="text-2xl m-4 font-bold md:text-xl md:leading-tight dark:text-white">
          {{t("home.keyFeatures.title")}}
        </h2>
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

            <span class="mx-1">{{t("home.keyFeatures.feature1")}}</span>
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

            <span class="mx-1">{{t("home.keyFeatures.feature2")}}</span>
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

            <span class="mx-1">{{t("home.keyFeatures.feature3")}}</span>
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

            <span class="mx-1">{{t("home.keyFeatures.feature4")}}</span>
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

            <span class="mx-1">{{t("home.keyFeatures.feature5")}}</span>
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

            <span class="mx-1">{{t("home.keyFeatures.feature6")}}</span>
          </div>
        </div>
        <div class="mb-5 border-b border-white/20" />
        <h2 class="text-2xl m-4 font-bold md:text-xl md:leading-tight dark:text-white">
          {{t("home.otherFeatures.title")}}
        </h2>

        <button
          type="button"
          @click="showModalBatchSearch"
          data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
          class="py-3.5 duration-300 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
        >
          <BaseIcon :path="mdiTextSearch" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="mr-3" />

          <div class="mr-2">
            {{t("batchSearch.button")}}
            </div>
        </button>

        <button
          type="button"
          disabled
          data-hs-overlay="#hs-vertically-centered-scrollable-batch1"
          class="py-3.5 duration-300 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-[#149de144] focus:ring-blue-600 transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:bg-[#149de15d] dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
        >
          <BaseIcon :path="mdiStarShootingOutline" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="mr-3" />
          <div class="mr-2">
            {{t("home.otherFeatures.ankiSupport")}}
          </div>
        </button>
      </div>

      <!-- End Col -->

      <div class="md:col-span-4">
        <!-- Accordion -->
        <section class="w-full p-1 rounded-lg">
          <div class="tab-content md:m-2">
            <div class="inline-flex justify-between items-center w-full mb-4">
              <h1 class="text-2xl font-bold md:text-3xl md:leading-tight dark:text-white">
                {{t("animeList.recentlyAddedTitle")}}
              </h1>
              <router-link to="/anime/all">
                <button
                  type="button"
                  class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
                >
                  {{t("animeList.seeAll")}}
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

            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-3">
              <div
                v-if="latest_anime_list.length > 0"
                v-for="(media_info, index) in latest_anime_list"
                class="w-full relative"
              >
                <Popper class="w-full" zIndex="50" arrow v-bind="$attrs" hover openDelay="0" closeDelay="0">
                  <div
                    class="border-none pb-[145%] rounded-md overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"
                  >
                    <img
                      class="w-full h-full object-cover absolute top-0 left-0"
                      :src="media_info.cover + '?width=230&height=326'"
                    />
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
                            <span class="font-bold pt-3 first:pt-0 dark:text-white">{{t("animeList.romajiName")}}:</span>
                            {{ media_info.romaji_name }}
                          </p>
                          <p>
                            <span class="font-bold pt-3 first:pt-0 dark:text-white">{{t("animeList.japaneseName")}}:</span>
                            {{ media_info.japanese_name }}
                          </p>
                          <p>
                            <span class="font-bold pt-3 first:pt-0 dark:text-white">{{t("animeList.seasons")}}:</span>
                            {{ media_info.num_seasons }}
                          </p>
                          <p>
                            <span class="font-bold pt-3 first:pt-0 dark:text-white">{{t("animeList.episodes")}}: </span>
                            {{ media_info.num_episodes }}
                          </p>
                          <p>
                            <span class="font-bold pt-3 first:pt-0 dark:text-white break-words">{{t("animeList.genres")}}: </span>
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
                <div class="text-center mt-1 justify-center flex flex-col items-center">
                  <h3 class="text-sm text-center font-medium line-clamp-2">
                    {{ media_info.num_segments }} {{t("animeList.sentenceCount")}}
                  </h3>
                </div>
              </div>
              <div v-else role="status" v-for="i in 10" class="animate-pulse relative">
                <div
                  class="w-full pb-[145%] rounded-md items-center overflow-hidden relative bg-[rgba(255,255,255,0.1)] block"
                ></div>
                <div class="mt-2 text-center justify-center flex flex-col items-center">
                  <div class="h-2.5 bg-gray-200 rounded-full dark:bg-sgray w-36 mt-2 mb-4"></div>
                </div>
                <div class="text-center mt-1 justify-center flex flex-col items-center">
                  <div class="h-2.5 bg-gray-200 rounded-full dark:bg-sgray w-28 mb-4"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <!-- End Accordion -->
      </div>
      <!-- End Col -->
    </div>
    <!-- End Grid -->
    <div class="my-10 border-b border-white/20" />
  </div>
  <section class="text-white p-4 lg:p-0 body-font">
    <h2 class="text-2xl m-4 -mt-8 font-bold md:text-xl md:leading-tight dark:text-white">
      {{t("home.stats.title")}}
    </h2>
    <div class="mx-auto -mb-12">
      <div class="flex flex-wrap -m-4 text-center">
        <div class="p-4 md:w-2/4 sm:w-1/2 w-full">
          <div class="bg-sgray2/60 border-none px-4 py-6 rounded-lg">
            <h2 class="title-font font-medium text-3xl text-white">+{{Math.ceil(general_stats.total_segments / 100) * 100}}</h2>
            <p class="leading-relaxed">
              {{t("home.stats.sentenceCount")}}
            </p>
          </div>
        </div>
        <div class="p-4 md:w-2/4 sm:w-1/2 w-full">
          <div class="bg-sgray2/60 border-none px-4 py-6 rounded-lg">
            <h2 class="title-font font-medium text-3xl text-white">{{general_stats.total_animes}}</h2>
            <p class="leading-relaxed">
              {{t("home.stats.mediaCount")}}
              </p>
          </div>
        </div>
      </div>
    </div>
  </section>
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
