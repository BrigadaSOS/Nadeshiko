<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
const selectedOption = ref('')
import { normalizeSentence } from '../../utils/misc'

import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const props = defineProps({
  item: {
    type: Object,
    default: null
  }
})

let sentence_jp = ref('')
let sentence_en = ref('')
let sentence_es = ref('')
let isNSFW = ref(false);

const boxjp = ref(null)
const boxen = ref(null)
const boxes = ref(null)  

const resize = () => {
  const adjustHeight = (element) => {
    element.style.height = 'auto'
    element.style.height = element.scrollHeight + 'px'
  }

  adjustHeight(boxjp.value)
  adjustHeight(boxen.value)
  adjustHeight(boxes.value)
}


watch(
  () => props.item,
  (newValue) => {
    if (newValue && newValue.segment_info) {
      sentence_jp.value = newValue.segment_info.content_jp
      sentence_en.value = newValue.segment_info.content_en
      sentence_es.value = newValue.segment_info.content_es

      // Usar requestAnimationFrame para asegurar que el ajuste de altura se realice después de que el DOM se haya actualizado
      requestAnimationFrame(() => {
        resize()
      })
    }
  },
  { immediate: true }
)

const submitEdit = async () => {
  let response = null
  const body = {
    uuid: props.item.segment_info.uuid, 
    content_jp: sentence_jp.value,
    content_en: sentence_en.value,
    content_es: sentence_es.value,
    isNSFW: isNSFW.value
  }
  try {
    response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'segment', {
      method: 'PUT',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    response = await response.json()
    console.log(response)
  } catch (error) {
    console.log(error)
    return
  }
  
}
</script>
<template>
  <div
    id="hs-vertically-centered-scrollable-editsentencemodal"
    class="hs-overlay-open:mt-7 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto flex items-center justify-center"
  >
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div
        class="max-h-full max-w-6xl flex flex-col bg-white border shadow-sm rounded-xl dark:bg-bgcolorcontext dark:border-sgray dark:shadow-slate-700/[.7]"
      >
        <div class="flex justify-between items-center py-3 px-4 border-b border-t dark:border-sgray2">
          <h3 class="font-bold text-gray-800 dark:text-white">Editar una oración</h3>
          <button
            type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-editsentencemodal"
          >
            <span class="sr-only">Close</span>
            <svg
              class="w-3.5 h-3.5"
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <div class="overflow-y-auto">
          <div class="flex flex-col lg:flex-row mx-auto">
            <div class="container overflow-hidden mx-auto flex flex-col">
              <div class="flex flex-row">
                <div class="container border-t border-t-sgray2 flex overflow-hidden flex-col w-screen">
                  <h2 class="font-bold text-center text-lg border-b border-sgray2 pb-3 text-gray-800 dark:text-white mt-3 px-5">
                    Previsualización
                  </h2>
                  <div
                    v-if="props.item"
                    :key="props.item.segment_info.position"
                    :id="props.item.segment_info.position"
                    class="flex mx-5 flex-col overflow-hidden rounded-none  py-4 border-sgray2 p-2"
                  >
                    <div class="h-64 w-auto">
                      <img
                        class="inset-0 h-full w-full object-cover object-center"
                        :src="props.item.media_info.path_image + '?width=960&height=540'"
                      />
                    </div>
                    <div class="w-full py-4  text-white flex flex-col justify-between">
                      <div className="inline-flex text-left items-center justify-center">
                        <button
                          class="focus:outline-none bg-sgray hover:bg-sgrayhover p-1.5 rounded-xl items-center"
                          @click="playSound(props.item.media_info.path_audio)"
                        >
                          <svg
                            aria-hidden="true"
                            class="w-6 mx-auto ml-0.5 fill-white text-white dark:text-white"
                            viewBox="0 0 130 130"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z"
                            ></path>
                          </svg>
                        </button>

                        <div class="flex flex-1">
                          <h3 class="font-semibold text-lg ml-2 leading-tight">
                            <span> {{ sentence_jp }}</span>
                          </h3>
                        </div>
                      </div>
                      <h4 class="font-normal text-sm leading-tight my-4">
                        <span
                          class="bg-gray-100 mb-1 text-gray-800 text-xs font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sgray dark:text-gray-400 border border-gray-700"
                        >
                          {{ t('searchpage.main.labels.translation') }}
                        </span>

                        <span
                          v-if="isNSFW" 
                          class="bg-gray-100 mb-1 text-gray-800 text-xs font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/30 dark:text-gray-400 border border-gray-700"
                        >
                          NSFW
                        </span>

                        <ul class="ml-5 list-disc text-gray-400">
                          <li class="my-2">{{ normalizeSentence(sentence_en) }}</li>
                          <li class="my-2">{{ normalizeSentence(sentence_es) }}</li>
                        </ul>
                      </h4>

                      <p class="text-sm text-white/50 tracking-wide font-semibold mt-2">
                        {{ props.item.basic_info.name_anime_en }} &bull;
                        <template v-if="props.item.basic_info.season === 0">
                          {{ t('searchpage.main.labels.movie') }}
                        </template>
                        <template v-else>
                          {{ t('searchpage.main.labels.season') }} {{ props.item.basic_info.season }},
                          {{ t('searchpage.main.labels.episode') }} {{ props.item.basic_info.episode }}
                        </template>
                      </p>
                    </div>
                  </div>

                  <div v-else>
                    <div v-for="i in 1" :key="i">
                      <div
                        role="status"
                        class="space-y-8 mt-4 animate-pulse md:space-y-0 md:space-x-8 md:flex md:items-center"
                      >
                        <div
                          class="flex items-center justify-center w-full h-48 bg-gray-300 rounded sm:w-96 dark:bg-sgray"
                        >
                          <svg
                            class="w-12 h-12 text-gray-200"
                            xmlns="http://www.w3.org/2000/svg"
                            aria-hidden="true"
                            fill="currentColor"
                            viewBox="0 0 640 512"
                          >
                            <path
                              d="M480 80C480 35.82 515.8 0 560 0C604.2 0 640 35.82 640 80C640 124.2 604.2 160 560 160C515.8 160 480 124.2 480 80zM0 456.1C0 445.6 2.964 435.3 8.551 426.4L225.3 81.01C231.9 70.42 243.5 64 256 64C268.5 64 280.1 70.42 286.8 81.01L412.7 281.7L460.9 202.7C464.1 196.1 472.2 192 480 192C487.8 192 495 196.1 499.1 202.7L631.1 419.1C636.9 428.6 640 439.7 640 450.9C640 484.6 612.6 512 578.9 512H55.91C25.03 512 .0006 486.1 .0006 456.1L0 456.1z"
                            />
                          </svg>
                        </div>
                        <div class="w-full">
                          <div class="h-2.5 bg-gray-200 rounded-full dark:bg-sgray w-48 mb-4"></div>
                          <div class="h-2 bg-gray-200 rounded-full dark:bg-sgray max-w-[780px] mb-2.5"></div>
                          <div class="h-2 bg-gray-200 rounded-full dark:bg-sgray max-w-[740px] mb-2.5"></div>
                          <div class="h-2 bg-gray-200 rounded-full dark:bg-sgray max-w-[760px] mb-2.5"></div>
                          <div class="h-2 bg-gray-200 rounded-full dark:bg-sgray max-w-[560px]"></div>
                        </div>
                        <span class="sr-only">Loading...</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="container w-full border-l border-l-sgray2 border-t border-t-sgray2 flex flex-col">
              <h2 class="font-bold text-center overflow-auto text-lg border-b border-sgray2 pb-3 text-gray-800 dark:text-white mt-3 px-5">
                Edición
              </h2>
              <form @submit="searchHandler">
                <div class="relative mx-5 mt-4">
                  <div class="flex">
                    <div class="flex flex-col w-full space-y-4">
                      <div class="relative group">
                        <div class="flex justify-between items-center">
                          <label for="with-corner-hint" class="block text-sm font-medium mb-2 dark:text-white"
                            >Oración en Japonés</label
                          >
                          <span class="block text-sm text-gray-500 mb-2">Obligatorio</span>
                        </div>
                        <textarea
                          @input="resize()"
                          ref="boxjp"
                          v-model="sentence_jp"
                          
                          rows="3"
                          type="search"
                          autocomplete="off"
                          class="transition block resize-none w-full p-3 text-base text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500 hover:border-gray-400"
                          placeholder="Añade aquí la oración en japonés"
                          required
                        />
                      </div>

                      <div class="relative group">
                        <div class="flex justify-between items-center">
                          <label for="with-corner-hint" class="block text-sm font-medium mb-2 dark:text-white"
                            >Oración en Inglés</label
                          >
                          <span class="block text-sm text-gray-500 mb-2">Obligatorio</span>
                        </div>
                        <textarea
                          @input="resize()"
                          v-model="sentence_en"
                          ref="boxen"
                          rows="3"
                          type="search"
                          autocomplete="off"
                          class="transition resize-none block w-full p-3 text-base text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500 hover:border-gray-400"
                          placeholder="Añade aquí la oración en inglés"
                          required
                        />
                      </div>

                      <div class="relative group">
                        <div class="flex justify-between items-center">
                          <label for="with-corner-hint" class="block text-sm font-medium mb-2 dark:text-white"
                            >Oración en Español</label
                          >
                          <span class="block text-sm text-gray-500 mb-2">Obligatorio</span>
                        </div>
                        <textarea
                          @input="resize()"
                          v-model="sentence_es"
                          ref="boxes"
                          rows="3"
                          type="search"
                          autocomplete="off"
                          class="transition block resize-none w-full p-3 text-base text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500 hover:border-gray-400"
                          placeholder="Añade aquí la oración en español"
                          required
                        />
                      </div>
                      <label class="block text-sm font-medium dark:text-white">Opciones varias</label>
                      <div class="flex items-center space-x-10">
                        <div>
                          <input
                            type="checkbox"
                            v-model="isNSFW" 
                            class="relative shrink-0 w-[3.25rem] h-7 bg-gray-100 checked:bg-none checked:bg-blue-600 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 border border-transparent ring-1 ring-transparent focus:border-blue-600 focus:ring-blue-600 ring-offset-white focus:outline-none appearance-none dark:bg-graypalid dark:checked:bg-blue-600 dark:focus:ring-offset-gray-800 before:inline-block before:w-6 before:h-6 before:bg-white checked:before:bg-blue-200 before:translate-x-0 checked:before:translate-x-full before:shadow before:rounded-full before:transform before:ring-0 before:transition before:ease-in-out before:duration-200 dark:before:bg-gray-400 dark:checked:before:bg-blue-200"
                          />
                          <label class="text-sm text-gray-500 ml-3 dark:text-gray-400">Contenido NSFW</label>
                        </div>
                        <div>
                          <input
                            type="checkbox"
                            checked
                            class="relative shrink-0 w-[3.25rem] h-7 bg-gray-100 checked:bg-none checked:bg-blue-600 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 border border-transparent ring-1 ring-transparent focus:border-blue-600 focus:ring-blue-600 ring-offset-white focus:outline-none appearance-none dark:bg-graypalid dark:checked:bg-blue-600 dark:focus:ring-offset-gray-800 before:inline-block before:w-6 before:h-6 before:bg-white checked:before:bg-blue-200 before:translate-x-0 checked:before:translate-x-full before:shadow before:rounded-full before:transform before:ring-0 before:transition before:ease-in-out before:duration-200 dark:before:bg-gray-400 dark:checked:before:bg-blue-200"
                          />
                          <label class="text-sm text-gray-500 ml-3 dark:text-gray-400">Visible</label>
                        </div>
                      </div>
                      <div class="pb-5">

                    </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-sgray2">

          <button
            type="button"
            @click="submitEdit"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-blue-500/70 text-gray-700 shadow-sm align-middle hover:bg-blue-500/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-sgray2 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
          >
            Editar
          </button>
          <button
            type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-sgray2 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-editsentencemodal"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
