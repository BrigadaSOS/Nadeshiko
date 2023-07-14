<script setup>
// Variado
import { useHead } from '@vueuse/head'
import { mdiTuneVariant } from '@mdi/js'
import { useToast } from 'vue-toastification'
import { ref, onMounted, computed } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'

// Importación de componentes
import router from '../router/index'
import NoResults from './NoResults.vue'
import BaseIcon from './minimal/BaseIcon.vue'
import ErrorConnection from './ErrorConnection.vue'
import ContextSentence from './ContextSentence.vue'
import ReportModal from './Showcase/ReportModal.vue'
import SidebarAnime from './Showcase/SidebarAnime.vue'
import SettingsSearchModal from './Showcase/SettingsSearchModal.vue'
import LandingPageShowcase from './LandingPageShowcase.vue'

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

// Importación de funciones
const toast = useToast()
const head = useHead()

// Declaración de variables
const querySearch = ref('')
let sentences = ref([])
let statistics = ref([])
let next_cursor = ref(null)
let isLoading = ref(false)
let anime_id = ref(null)
let isModalContextActive = ref(false)
let isModalReportActive = ref(false)
let isModalSettingsSearchActive = ref(false)
let currentSentence = ref()
let contextactive = ref()
let status = ref()
let error_connection = ref(false)
let no_results = ref(false)
let querySearchAnime = ref('')
let isBannerClosed = ref(null)
let uuid = ref(null)
let currentAudio = ref(null)
let type_sort = ref(null)
let metadata = ref(null)

onBeforeRouteUpdate(async (to, from) => {
  const searchTerm = to.query.query
  const sortFilter = to.query.sort
  if (searchTerm && !sortFilter) {
    type_sort.value = null
    querySearch.value = searchTerm
    await getSentences(searchTerm)
  }
  if (searchTerm && sortFilter) {
    querySearch.value = searchTerm
    type_sort.value = sortFilter
    await getSentences(searchTerm)
  }
})

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const searchTerm = urlParams.get('query')
  const sortFilter = urlParams.get('sort')

  isBannerClosed = localStorage.getItem('isBannerClosed')
  let element = document.getElementById('drawer-button')

  uuid.value = urlParams.get('uuid')

  // Configuración del filtro
  if (sortFilter === 'asc') {
    type_sort.value = 'asc'
  } else if (sortFilter === 'desc') {
    type_sort.value = 'desc'
  } else {
    type_sort.value = null
  }

  if (searchTerm && uuid.value) {
  } else if (searchTerm && !uuid.value) {
    querySearch.value = searchTerm
    await getSentences(searchTerm)
  } else if (uuid.value) {
    await getSentences('', '', '', uuid.value)
  }

  // Observa el elemento al final del contenedor solo si no hay un UUID
  const observer = new IntersectionObserver(loadMoreSentences, {
    root: null,
    rootMargin: '1400px',
    threshold: 0.5
  })

  const sentinel = document.getElementById('sentinel')
  observer.observe(sentinel)

  // Arregla la posición de la barra de búsqueda y categorias al hacer scroll
  var prevScrollpos = window.scrollY
  window.onscroll = function () {
    var currentScrollPos = window.scrollY
    if (prevScrollpos > currentScrollPos) {
      document.getElementById('search-bar').style.top = '0'
      document.getElementById('search-anime').style.top = '80px'
    } else {
      document.getElementById('search-bar').style.top = '-50px'
      document.getElementById('search-anime').style.top = '30px'
    }
    prevScrollpos = currentScrollPos
  }

  if (isBannerClosed === null || isBannerClosed === true) {
    element.style.position = 'absolute'
    element.style.top = '-120px'
    element.style.right = '0px'
  }
})

document.addEventListener('DOMContentLoaded', function () {
  var prevScrollpos = window.scrollY
  var isScrolling = false

  function handleScroll() {
    if (!isScrolling) {
      isScrolling = true

      setTimeout(function () {
        var currentScrollPos = window.scrollY
        if (prevScrollpos > currentScrollPos) {
          document.getElementById('search-bar').style.top = '0'
          document.getElementById('search-anime').style.top = '80px'
        } else {
          document.getElementById('search-bar').style.top = '-50px'
          document.getElementById('search-anime').style.top = '30px'
        }

        prevScrollpos = currentScrollPos
        isScrolling = false
      }, 100) // Establece el intervalo de tiempo deseado en milisegundos
    }
  }

  window.addEventListener('scroll', handleScroll)
})

document.addEventListener('DOMContentLoaded', function () {
  var prevScrollpos = window.scrollY
  var isScrolling = false

  function handleScroll() {
    if (!isScrolling) {
      isScrolling = true

      setTimeout(function () {
        var currentScrollPos = window.scrollY
        if (prevScrollpos > currentScrollPos) {
          document.getElementById('search-bar').style.top = '0'
          document.getElementById('search-anime').style.top = '80px'
        } else {
          document.getElementById('search-bar').style.top = '-50px'
          document.getElementById('search-anime').style.top = '30px'
        }

        prevScrollpos = currentScrollPos
        isScrolling = false
      }, 100) // Establece el intervalo de tiempo deseado en milisegundos
    }
  }

  window.addEventListener('scroll', handleScroll)
})

const filteredAnimes = computed(() => {
  const filteredItems = statistics.value.filter((item) => {
    return item.name_anime_en.toLowerCase().includes(querySearchAnime.value.toLowerCase())
  })

  const sortedItems = filteredItems.sort((a, b) => {
    const nameA = a.name_anime_en.toLowerCase()
    const nameB = b.name_anime_en.toLowerCase()
    if (nameA === t('searchpage.main.labels.all').toLowerCase()) return -1
    if (nameB === t('searchpage.main.labels.all').toLowerCase()) return 1
    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })

  return sortedItems
})

// Lógica de la barra de búsqueda
const searchHandler = async (event) => {
  event.preventDefault()
  const searchTerm = querySearch.value.trim()
  if (searchTerm !== '') {
    if (type_sort.value === null) {
      await router.push({ query: { query: querySearch.value } })
    } else {
      await router.push({ query: { query: querySearch.value, sort: type_sort.value } })
    }
    console.log(type_sort.value)
    await getSentences(searchTerm)
  }
}
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

// Invoca a la API para obtener la lista de oraciones de forma recursiva
const getSentences = async (searchTerm, cursor, animeId, uuid) => {
  isLoading.value = true
  error_connection.value = false
  anime_id.value = animeId
  let response = null
  // await delay(2000)
  try {
    response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'search/anime/sentence', {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        "x-api-key": import.meta.env.VITE_APP_X_API_KEY
      },
      body: JSON.stringify({
        query: searchTerm,
        cursor: cursor,
        anime_id: anime_id.value,
        uuid: uuid,
        limit: 10,
        content_sort: type_sort.value
      })
    })
    response = await response.json()
    if (response.sentences.length === 0) {
      no_results.value = true
    }
  } catch (error) {
    console.log(error)
    error_connection.value = true
    return
  }

  status.value = response
  // Concatena los nuevos elementos solo si hay un cursor
  sentences.value = cursor ? sentences.value.concat(response.sentences) : response.sentences
  statistics.value = response.statistics
  const default_row_statistics = {
    anime_id: 0,
    name_anime_en: t('searchpage.main.labels.all'),
    amount_sentences_found: statistics.value.reduce((a, b) => a + parseInt(b.amount_sentences_found), 0)
  }

  statistics.value = [default_row_statistics].concat(statistics.value)

  metadata.value = response.metadata
  next_cursor.value = response.cursor
  isLoading.value = false
}

// Función para cargar más elementos al final de la página
const loadMoreSentences = async (entries) => {
  if (entries[0].isIntersecting && next_cursor.value && !isLoading.value) {
    await getSentences(querySearch.value, next_cursor.value, anime_id.value, '')
  }
}

// Función para filtrar por elementos encontrados
const filterAnime = async (anime_id) => {
  next_cursor.value = null
  sentences.value = []
  window.scrollTo(0, 0)
  await getSentences(querySearch.value, 0, anime_id)
}

// Habilita la reproducción de audio de las oraciones
const playSound = async (sound) => {
  // Si hay un audio en reproducción, se detiene
  if (currentAudio.value) {
    currentAudio.value.pause()
    currentAudio.value.currentTime = 0
  }

  // Se crea una nueva instancia de Audio para el nuevo sonido
  const audio = new Audio(sound)

  // Se asigna el audio actual a la referencia
  currentAudio.value = audio

  // Se reproduce el nuevo audio
  await audio.play()
}

// Invoca el modal contenedor del contexto
const showModalContext = async (item) => {
  isModalContextActive.value = true
  currentSentence.value = item
  contextactive.value.getContextSentence(currentSentence.value)
}

// Invoca el modal contenedor para hacer reportes
const showModalReport = async (item) => {
  isModalReportActive.value = true
  currentSentence.value = item
}

// Invoca el modal de la configuración de la barra de busqueda
const showModalSettingsSearch = async () => {
  isModalSettingsSearchActive.value = true
}

// Descarga el audio o imagen de la oración
const downloadAudioOrImage = (url, filename) => {
  fetch(url)
    .then((response) => response.blob())
    .then((blob) => {
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      window.URL.revokeObjectURL(url)
    })
}

// Copia al portapapeles el contenido
const copyToClipboard = async (item) => {
  const options = {
    timeout: 3000,
    position: 'bottom-right'
  }
  try {
    await navigator.clipboard.writeText(item)
    const message = t('searchpage.main.labels.copiedcontent')
    toast.success(message, options)
  } catch (error) {
    const message = t('searchpage.main.labels.errorcopiedcontent')
    toast.error(message, options)
  }
}

// Obtiene la URL de la oración para compartir
const getSharingURL = async (sentence) => {
  const options = {
    timeout: 3000,
    position: 'bottom-right'
  }
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/?uuid=${sentence.segment_info.uuid}`)
    const message = t('searchpage.main.labels.copiedsharingurl')
    toast.success(message, options)
  } catch (error) {
    const message = t('searchpage.main.labels.errorcopiedsharingurl')
    toast.error(message, options)
  }
}

const sortFilter = async (type) => {
  type_sort.value = type
  next_cursor.value = null // Reiniciar el valor del cursor para obtener los primeros elementos
  sentences.value = [] // Reiniciar la lista de oraciones
  window.scrollTo(0, 0)
  if (type === 'none') {
    await router.push({ query: { query: querySearch.value } })
  } else {
    await router.push({ query: { query: querySearch.value, sort: type_sort.value } })
  }
  await getSentences(querySearch.value, 0, anime_id.value)
}

const ampliarImagen = (url) => {
  var ampliada = document.createElement('div')
  ampliada.className = 'ampliada'

  var imgAmpliada = document.createElement('img')
  imgAmpliada.src = url

  ampliada.appendChild(imgAmpliada)
  document.body.appendChild(ampliada)

  ampliada.onclick = function () {
    document.body.removeChild(ampliada)
  }
}

// NO QUITAR, inicializa el componente para que no falle
try {
  contextactive.value.getContextSentence(currentSentence.value)
} catch (error) {
  isModalContextActive.value = true
  isModalReportActive.value = true
}

// VARIABLES con traducciones en lugares imposibles de forma directa
let placeholder_search1 = t('searchpage.main.labels.searchmain')
let placeholder_search2 = t('searchpage.main.labels.searchbar')
</script>
<template>
  <div class="sticky z-30 top-0" id="search-bar">
    <form @submit="searchHandler">
      <label for="default-search" class="mb-2 text-sm font-medium z-30 text-gray-900 sr-only dark:text-white">{{
        t('searchpage.main.buttons.search')
      }}</label>
      <div class="relative lg:w-11/12 mx-auto mt-4">
        <div class="flex">
          <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
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
            <input
              v-model="querySearch"
              type="search"
              id="default-search"
              autocomplete="off"
              class="block w-full p-4 pl-10 text-sm text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
              :placeholder="placeholder_search1"
              required
            />
            <a
              @click="showModalSettingsSearch()"
              data-hs-overlay="#hs-vertically-centered-scrollable-modal3"
              class="text-white cursor-pointer absolute right-[94px] bottom-2.5 focus:outline-none focus:ring-blue-300 rounded-lg text-sm px-4 pt-2 pb-1 dark:bg-graypalid dark:hover:bg-gray-500"
            >
              <BaseIcon :path="mdiTuneVariant" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
            </a>
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
  <div class="flex flex-row lg:w-11/12 mx-auto" @scroll="loadMoreSentences">
    <div class="container mx-auto w-100 flex flex-col">
      <div
        v-if="sentences.length > 0"
        v-for="(sentence, index) in sentences"
        class="flex flex-col md:flex-row overflow-hidden border-b py-6 mr-0 lg:mr-10 border-sgray2 rounded-none mt-4 w-100"
      >
        <div class="h-auto w-auto md:w-6/12">
          <img
            class="inset-0 h-full w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
            :src="sentence.media_info.path_image"
            @click="ampliarImagen(sentence.media_info.path_image)"
          />
        </div>
        <div class="w-full py-6 sm:py-2 px-6 text-white justify-between">
          <div className="flex">
            <button class="focus:outline-none" @click="playSound(sentence.media_info.path_audio)">
              <svg
                aria-hidden="true"
                class="w-6 mx-2 fill-white hover:fill-gray-400 text-white dark:text-white"
                viewBox="0 0 150 150"
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
            <h3 class="font-semibold text-xl leading-tight">
              <span v-html="sentence.segment_info.content_highlight"></span>
            </h3>
          </div>

          <h4 class="font-normal text-sm leading-tight my-4">
            <span
              class="bg-gray-100 mb-1 text-gray-800 text-xs font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sgray dark:text-gray-400 border border-gray-500"
            >
              {{ t('searchpage.main.labels.translation') }}
            </span>

            <ul class="ml-5 list-disc text-gray-400">
              <li class="my-2">{{ sentence.segment_info.content_en }}</li>
              <li class="my-2">{{ sentence.segment_info.content_es }}</li>
            </ul>
          </h4>

          <div class="flex flex-wrap">
            <div class="">
              <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                <button
                  id="hs-dropdown-with-title"
                  type="button"
                  class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-sgray shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-sgrayhover dark:text-gray-300 dark:hover:text-white"
                >
                  <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      fill-rule="evenodd"
                      d="M7.646 10.854a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 9.293V5.5a.5.5 0 0 0-1 0v3.793L6.354 8.146a.5.5 0 1 0-.708.708l2 2z"
                    />
                    <path
                      d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383zm.653.757c-.757.653-1.153 1.44-1.153 2.056v.448l-.445.049C2.064 6.805 1 7.952 1 9.318 1 10.785 2.23 12 3.781 12h8.906C13.98 12 15 10.988 15 9.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 4.825 10.328 3 8 3a4.53 4.53 0 0 0-2.941 1.1z"
                    />
                  </svg>

                  {{ t('searchpage.main.buttons.download') }}

                  <svg
                    class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-gray-300"
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
                  class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                  aria-labelledby="hs-dropdown-with-title"
                >
                  <div class="py-2 first:pt-0 last:pb-0">
                    <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                      {{ t('searchpage.main.labels.multimedia') }}
                    </span>
                    <a
                      class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                      @click="
                        downloadAudioOrImage(
                          sentence.media_info.path_image,
                          sentence.media_info.path_image.split('/').pop()
                        )
                      "
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25" fill="none">
                        <path
                          d="M21 22H3C2.72 22 2.5 21.6517 2.5 21.2083V3.79167C2.5 3.34833 2.72 3 3 3H21C21.28 3 21.5 3.34833 21.5 3.79167V21.2083C21.5 21.6517 21.28 22 21 22Z"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M4.5 19.1875L9.66 12.6875C9.86 12.4375 10.24 12.4375 10.44 12.6875L15.6 19.1875"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M16.2 16.6975L16.4599 16.3275C16.6599 16.0775 17.0399 16.0775 17.2399 16.3275L19.4999 19.1875"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M17.2046 9.54315C17.2046 10.4294 16.4862 11.1478 15.6 11.1478C14.7138 11.1478 13.9954 10.4294 13.9954 9.54315C13.9954 8.65695 14.7138 7.93854 15.6 7.93854C16.4862 7.93854 17.2046 8.65695 17.2046 9.54315Z"
                          stroke="#white"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.image') }}
                    </a>
                    <a
                      class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                      @click="
                        downloadAudioOrImage(
                          sentence.media_info.path_audio,
                          sentence.media_info.path_audio.split('/').pop()
                        )
                      "
                    >
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 130 130" fill="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z"
                        ></path>
                      </svg>
                      {{ t('searchpage.main.buttons.audio') }}
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                <button
                  id="hs-dropdown-with-title"
                  type="button"
                  class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
                >
                  <svg
                    width="1em"
                    height="1em"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                    class="rs-icon"
                    aria-label="copy"
                    data-category="action"
                  >
                    <path
                      d="M13 11.5a.5.5 0 01.5-.5h.5a1 1 0 001-1V2a1 1 0 00-1-1H6a1 1 0 00-1 1v.5a.5.5 0 01-1 0V2a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-.5a.5.5 0 01-.5-.5z"
                    ></path>
                    <path
                      d="M2 5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1H2zm0-1h8a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V6a2 2 0 012-2z"
                    ></path>
                  </svg>
                  {{ t('searchpage.main.buttons.copyclipboard') }}

                  <svg
                    class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-gray-300"
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
                  class="z-30 hs-dropdown-menu transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                  aria-labelledby="hs-dropdown-with-title"
                >
                  <div class="py-2 first:pt-0 last:pb-0">
                    <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                      Multimedia
                    </span>
                    <a
                      @click="copyToClipboard(sentence.media_info.path_image)"
                      class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25" fill="none">
                        <path
                          d="M21 22H3C2.72 22 2.5 21.6517 2.5 21.2083V3.79167C2.5 3.34833 2.72 3 3 3H21C21.28 3 21.5 3.34833 21.5 3.79167V21.2083C21.5 21.6517 21.28 22 21 22Z"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M4.5 19.1875L9.66 12.6875C9.86 12.4375 10.24 12.4375 10.44 12.6875L15.6 19.1875"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M16.2 16.6975L16.4599 16.3275C16.6599 16.0775 17.0399 16.0775 17.2399 16.3275L19.4999 19.1875"
                          stroke="white"
                          stroke-miterlimit="10"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                        <path
                          d="M17.2046 9.54315C17.2046 10.4294 16.4862 11.1478 15.6 11.1478C14.7138 11.1478 13.9954 10.4294 13.9954 9.54315C13.9954 8.65695 14.7138 7.93854 15.6 7.93854C16.4862 7.93854 17.2046 8.65695 17.2046 9.54315Z"
                          stroke="#white"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.image') }}
                    </a>
                    <a
                      @click="copyToClipboard(sentence.media_info.path_audio)"
                      class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    >
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 130 130" fill="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z"
                        ></path>
                      </svg>
                      {{ t('searchpage.main.buttons.audio') }}
                    </a>
                  </div>
                  <div class="py-2 first:pt-0 last:pb-0">
                    <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                      {{ t('searchpage.main.labels.text') }}
                    </span>
                    <a
                      @click="copyToClipboard(sentence.segment_info.content_jp)"
                      class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    >
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path
                          d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                        />
                        <path
                          d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.jpsentence') }}
                    </a>
                    <a
                      class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                      @click="copyToClipboard(sentence.segment_info.content_en)"
                    >
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path
                          d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                        />
                        <path
                          d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.ensentence') }}
                    </a>
                    <a
                      class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                      @click="copyToClipboard(sentence.segment_info.content_es)"
                    >
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path
                          d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                        />
                        <path
                          d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.essentence') }}
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div class="relative inline-flex mb-2 mr-2">
                <button
                  @click="showModalContext(sentence)"
                  data-hs-overlay="#hs-vertically-centered-scrollable-modal"
                  type="button"
                  class="dark:bg-sgray outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                    class="rs-icon w-4 h-[22px]"
                  >
                    <path
                      d="M4 2a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H4zm0-1h8a3 3 0 013 3v8a3 3 0 01-3 3H4a3 3 0 01-3-3V4a3 3 0 013-3z"
                    ></path>
                    <path
                      d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"
                    ></path>
                  </svg>
                  {{ t('searchpage.main.buttons.context') }}
                </button>
              </div>
            </div>
            <div>
              <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                <button
                  id="hs-dropdown-with-title"
                  type="button"
                  class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800"
                >
                  <svg
                    class="hs-dropdown-open:rotate-180 w-5 h-5 rotate-90 fill-white text-gray-300"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M14 5C14 6.10457 13.1046 7 12 7C10.8954 7 10 6.10457 10 5C10 3.89543 10.8954 3 12 3C13.1046 3 14 3.89543 14 5Z"
                    />
                    <path
                      d="M14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12Z"
                    />
                    <path
                      d="M12 21C13.1046 21 14 20.1046 14 19C14 17.8954 13.1046 17 12 17C10.8954 17 10 17.8954 10 19C10 20.1046 10.8954 21 12 21Z"
                    />
                  </svg>
                </button>

                <div
                  class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                  aria-labelledby="hs-dropdown-with-title"
                >
                  <div class="py-2 first:pt-0 last:pb-0">
                    <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                      {{ t('searchpage.main.labels.options') }}
                    </span>
                    <a
                      class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-redalert dark:hover:text-gray-300"
                      @click="showModalReport(sentence)"
                      data-hs-overlay="#hs-vertically-centered-scrollable-modal2"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        xmlns:xlink="http://www.w3.org/1999/xlink"
                        width="20"
                        height="20"
                        class="fill-white"
                        version="1.1"
                        id="Layer_1"
                        viewBox="0 0 512 512"
                      >
                        <g>
                          <g>
                            <path
                              d="M505.403,406.394L295.389,58.102c-8.274-13.721-23.367-22.245-39.39-22.245c-16.023,0-31.116,8.524-39.391,22.246    L6.595,406.394c-8.551,14.182-8.804,31.95-0.661,46.37c8.145,14.42,23.491,23.378,40.051,23.378h420.028    c16.56,0,31.907-8.958,40.052-23.379C514.208,438.342,513.955,420.574,505.403,406.394z M477.039,436.372    c-2.242,3.969-6.467,6.436-11.026,6.436H45.985c-4.559,0-8.784-2.466-11.025-6.435c-2.242-3.97-2.172-8.862,0.181-12.765    L245.156,75.316c2.278-3.777,6.433-6.124,10.844-6.124c4.41,0,8.565,2.347,10.843,6.124l210.013,348.292    C479.211,427.512,479.281,432.403,477.039,436.372z"
                            />
                          </g>
                        </g>
                        <g>
                          <g>
                            <path
                              d="M256.154,173.005c-12.68,0-22.576,6.804-22.576,18.866c0,36.802,4.329,89.686,4.329,126.489    c0.001,9.587,8.352,13.607,18.248,13.607c7.422,0,17.937-4.02,17.937-13.607c0-36.802,4.329-89.686,4.329-126.489    C278.421,179.81,268.216,173.005,256.154,173.005z"
                            />
                          </g>
                        </g>
                        <g>
                          <g>
                            <path
                              d="M256.465,353.306c-13.607,0-23.814,10.824-23.814,23.814c0,12.68,10.206,23.814,23.814,23.814    c12.68,0,23.505-11.134,23.505-23.814C279.97,364.13,269.144,353.306,256.465,353.306z"
                            />
                          </g>
                        </g>
                      </svg>
                      {{ t('searchpage.main.buttons.report') }}
                    </a>
                    <a
                      class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                      @click="getSharingURL(sentence)"
                    >
                      <svg
                        class="fill-white"
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 50 50"
                      >
                        <path
                          d="M31.2,14.2,41,24.1l-9.8,9.8V26.8L27,27c-6.8.3-12,1-16.1,2.4,3.6-3.8,9.3-6.8,16.7-7.5l3.6-.3V14.2M28.3,6a1.2,1.2,0,0,0-1.1,1.3V17.9C12,19.4,2.2,29.8,2,40.3c0,.6.2,1,.6,1s.7-.3,1.1-1.1c2.4-5.4,7.8-8.5,23.5-9.2v9.7A1.2,1.2,0,0,0,28.3,42a.9.9,0,0,0,.8-.4L45.6,25.1a1.5,1.5,0,0,0,0-2L29.1,6.4a.9.9,0,0,0-.8-.4Z"
                        />
                      </svg>
                      {{ t('searchpage.main.buttons.share') }}
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p class="text-sm text-gray-600 tracking-wide font-semibold mt-2">
            {{ sentence.basic_info.name_anime_en }} &bull;
            <template v-if="sentence.basic_info.season === 0"> {{ t('searchpage.main.labels.movie') }} </template>
            <template v-else>
              {{ t('searchpage.main.labels.season') }} {{ sentence.basic_info.season }},
              {{ t('searchpage.main.labels.episode') }} {{ sentence.basic_info.episode }}
            </template>
          </p>
        </div>
      </div>

      <div v-else-if="sentences.length === 0 && querySearch !== '' && isLoading === true && error_connection === false">
        <div v-for="i in 4" :key="i">
          <div
            role="status"
            class="border-sgray2 border-b space-y-8 mt-6 animate-pulse md:space-y-0 md:space-x-8 md:flex md:items-center"
          >
            <div
              class="flex mb-10 items-center justify-center bg-gray-300 rounded h-64 w-auto md:w-5/12 dark:bg-graypalid"
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
              <div class="h-2.5 bg-gray-200 rounded-full dark:bg-graypalid max-w-[320px] mb-4"></div>
              <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[680px] mb-2.5"></div>
              <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[640px] mb-2.5"></div>
              <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[660px] mb-2.5"></div>
              <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[560px]"></div>
            </div>
            <span class="sr-only">Loading...</span>
          </div>
        </div>
      </div>
      <div v-else-if="error_connection === true">
        <ErrorConnection />
      </div>
      <div v-else-if="no_results === true && error_connection === false">
        <NoResults />
      </div>
      <div v-else>
        <LandingPageShowcase />
      </div>
      <div id="sentinel"></div>
      <div v-if="isLoading && sentences.length > 0 && error_connection === false" class="text-center">
        <div
          class="animate-spin inline-block w-6 h-6 my-5 border-[3px] border-current border-t-transparent text-blue-600 rounded-full"
          role="status"
          aria-label="loading"
        >
          <span class="sr-only">Loading...</span>
        </div>
      </div>
    </div>
    <SettingsSearchModal v-if="isModalSettingsSearchActive" />
    <ContextSentence v-if="isModalContextActive" :item="currentSentence" ref="contextactive" />
    <ReportModal v-if="isModalReportActive" :item="currentSentence" />

    <div v-if="statistics.length > 1" class="hidden w-3/12 lg:flex flex-col py-6 ml-10">
      <div id="search-anime" class="sticky -mt-2">
        <div class="relative">
          <div class="hs-dropdown relative inline-block w-full z-30">
            <button
              id="hs-dropdown-default"
              type="button"
              class="hs-dropdown-toggle py-3 px-4 w-full mb-4 inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle hover:bg-gray-50 focus:ring-blue-600 transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            >
              <svg
                aria-hidden="true"
                class="w-6 mx-2 fill-white hover:fill-gray-400 text-white dark:text-white"
                viewBox="0 -1 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  xmlns="http://www.w3.org/2000/svg"
                  id="Path_36"
                  data-name="Path 36"
                  d="M28.854,12.146a.5.5,0,0,1,0,.708l-3,3a.518.518,0,0,1-.163.109.5.5,0,0,1-.382,0,.518.518,0,0,1-.163-.109l-3-3a.5.5,0,0,1,.708-.708L25,14.293V.5a.5.5,0,0,1,1,0V14.293l2.146-2.147A.5.5,0,0,1,28.854,12.146Zm9-9-3-3a.518.518,0,0,0-.163-.109.505.505,0,0,0-.382,0,.518.518,0,0,0-.163.109l-3,3a.5.5,0,0,0,.708.708L34,1.707V15.5a.5.5,0,0,0,1,0V1.707l2.146,2.147a.5.5,0,1,0,.708-.708Z"
                  transform="translate(-22)"
                />
              </svg>
              <div>
                {{ t('searchpage.main.buttons.sortmain') }}
                <span v-if="type_sort === 'asc'">({{ t('searchpage.main.buttons.sortlengthmin') }})</span>
                <span v-else-if="type_sort === 'desc'">({{ t('searchpage.main.buttons.sortlengthmax') }})</span>
              </div>
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
              class="hs-dropdown-menu transition-[opacity,margin] duration-[0.1ms] hs-dropdown-open:opacity-100 opacity-0 w-2/12 hidden z-10 mt-2 min-w-[15rem] bg-white shadow-md rounded-lg p-2 dark:bg-sgray dark:border dark:border-gray-600 dark:divide-gray-700"
              aria-labelledby="hs-dropdown-default"
            >
              <a
                class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                @click="sortFilter('none')"
              >
                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path
                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                  />
                  <path
                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                  />
                </svg>
                {{ t('searchpage.main.buttons.sortlengthnone') }}
              </a>
              <a
                class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                @click="sortFilter('asc')"
              >
                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path
                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                  />
                  <path
                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                  />
                </svg>
                {{ t('searchpage.main.buttons.sortlengthmin') }}
              </a>
              <a
                class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                @click="sortFilter('desc')"
              >
                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path
                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z"
                  />
                  <path
                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z"
                  />
                </svg>
                {{ t('searchpage.main.buttons.sortlengthmax') }}
              </a>
            </div>
          </div>
          <div class="flex flex-inline">
            <input
              type="search"
              v-model="querySearchAnime"
              id="default-search2"
              autocomplete="off"
              class="block w-full p-4 pl-4 mb-4 text-sm text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
              :placeholder="placeholder_search2"
              required
            />
            <div class="absolute z-20 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
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
          </div>

          <ul
            class="sticky z-20 divide-y divide-gray-600 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-sgray dark:border-gray-600 dark:text-white"
          >
            <li v-for="item in filteredAnimes">
              <button
                @click="filterAnime(item.anime_id)"
                class="flex items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-left rounded-t-lg dark:border-gray-600"
              >
                <span>{{ item.name_anime_en }}</span>
                <span class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">{{
                  item.amount_sentences_found
                }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
    <div v-else-if="sentences.length === 0 && querySearch !== '' && isLoading === true && error_connection === false">
      <div role="status" class="hidden w-11/12 lg:flex flex-col py-6 animate-pulse">
        <div class="h-2.5 bg-gray-200 rounded-full dark:bg-graypalid w-48 mb-4"></div>
        <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[460px] mb-2.5"></div>
        <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid mb-2.5"></div>
        <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[330px] mb-2.5"></div>
        <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[300px] mb-2.5"></div>
        <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[360px]"></div>
        <span class="sr-only">Cargando...</span>
      </div>
    </div>
  </div>
  <SidebarAnime
    :list="statistics"
    :sentences="sentences"
    :type_sort="type_sort"
    @filter-anime="filterAnime"
    @filter-anime-length="sortFilter"
  />
</template>

<style>
#search-bar,
#unique-animes {
  transition: top 0.4s ease;
}
#search-anime {
  transition: top 0.4s ease;
}
.image-container {
  position: relative;
}

.ampliada {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.ampliada img {
  max-width: 90%;
  max-height: 90%;
}

.keyword {
  text-decoration: underline;
  text-underline-offset: 0.2em;
  color: rgb(251, 120, 120);
}
</style>
