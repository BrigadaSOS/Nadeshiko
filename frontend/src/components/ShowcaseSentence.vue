<script setup>
import { userStore } from '../stores/user'
import {
  mdiArrowCollapseRight,
  mdiTextSearch,
  mdiTranslate,
  mdiStarShootingOutline,
  mdiPencilOutline,
  mdiRefresh,
  mdiFileVideo,
  mdiArrowCollapseLeft
} from '@mdi/js'
import { useToast } from 'vue-toastification'
import { ref, onMounted, computed } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { normalizeSentence } from '../utils/misc'

// Importación de componentes
import router from '../router/index'
import NoResults from './NoResults.vue'
import SearchBarSentences from './minimal/SearchBarSentences.vue'
import BaseIcon from './minimal/BaseIcon.vue'
import ErrorConnection from './ErrorConnection.vue'
import ContextSentence from './ContextSentence.vue'
import ReportModal from './Showcase/ReportModal.vue'
import SidebarAnime from './Showcase/SidebarAnime.vue'
import BatchSearchModal from './BatchSearchModal.vue'
import EditSentenceModal from './Showcase/EditSentenceModal.vue'
// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

const orderedSegments = computed(() => {
  const segments = [
    {
      content: 'content_es',
      highlight: 'content_es_highlight',
      mt: 'content_es_mt'
    },
    {
      content: 'content_en',
      highlight: 'content_en_highlight',
      mt: 'content_en_mt'
    }
  ]

  if (locale.value === 'en') {
    return [segments[1], segments[0]]
  }
  return segments
})

// Importación de funciones
const toast = useToast()
const store = userStore()
const querySearch = ref('')
let searchBarHeight = ref(0)

// Declaración de variables
const user = computed(() => store.userInfo)
let sentences = ref([])
let statistics = ref([])
let category_statistics = ref([])
let next_cursor = ref(null)
let isLoading = ref(false)
let anime_id = ref(null)
const exactMatchFromStore = computed(() => store.$state.filterPreferences.exact_match)
const exact_match = ref(null)
let isModalContextActive = ref(false)
let isModalReportActive = ref(false)
let isModalBatchSearchActive = ref(false)
let currentSentence = ref()
let contextactive = ref()
let status = ref()
let error_connection = ref(false)
let no_results = ref(false)
let querySearchAnime = ref('')
let uuid = ref(null)
let currentAudio = ref(null)
let type_sort = ref(null)
let metadata = ref(null)
let random_seed = ref(null)
let categorySelected = ref(0)
const isMounted = ref(false)
let selected_season = ref(null)
let selected_episode = ref(null)
let filtersVisible = ref(true)

const delay = (ms) => new Promise((res) => setTimeout(res, ms))

onBeforeRouteUpdate(async (to, from) => {
  const searchTerm = to.query.query
  const sortFilter = to.query.sort
  const animeId = to.query.anime_id
  const exactMatch = to.query.exact_match
  const season = to.query.season
  const episodeParam = to.query.episode;
  if (episodeParam) {
    selectedEpisodes.value = episodeParam.split(',').map(num => parseInt(num.trim()));
  }
  selected_season.value = season
  querySearch.value = searchTerm || ''
  type_sort.value = sortFilter || null
  exact_match.value = exactMatchFromStore.value !== null ? exactMatchFromStore.value : exactMatch === 'true'

  if (isMounted.value && searchTerm) {
    await getSentences(searchTerm, null, animeId, undefined, selected_season.value, selectedEpisodes.value)
  } else {
    querySearch.value = ''
    sentences.value = []
    statistics.value = []
    error_connection.value = false
    isLoading.value = false
    no_results.value = false
    next_cursor.value = null
    uuid.value = null
    anime_id.value = null
    selected_season.value = null
    selectedEpisodes.value = null
  }
})

onMounted(async () => {

  const urlParams = new URLSearchParams(window.location.search)
  const searchTerm = urlParams.get('query')
  const sortFilter = urlParams.get('sort')
  const animeId = urlParams.get('anime_id')
  const season = urlParams.get('season')
  const episodeParam = urlParams.get('episode');
  if (episodeParam) {
    selectedEpisodes.value = episodeParam.split(',').map(num => parseInt(num.trim()));
  }
  const exactMatch = urlParams.get('exact_match')
  /*
  const metaTitle = computed(() => `${querySearch.value} - NadeDB`);
  const metaDescription = computed(() => `Viewing search results for ${querySearch.value} on NadeDB.`);
  useHead({
    title: metaTitle,
    meta: [
      {
        name: 'description',
        content: metaDescription,
      },
    ],
  });*/
  let element = document.getElementById('drawer-button')

  uuid.value = urlParams.get('uuid')
  anime_id.value = animeId
  selected_season.value = season
  exact_match.value = exactMatchFromStore.value !== null ? exactMatchFromStore.value : exactMatch === 'true'

  // Configuración del filtro
  if (sortFilter === 'asc') {
    type_sort.value = 'asc'
  } else if (sortFilter === 'desc') {
    type_sort.value = 'desc'
  } else if (sortFilter === 'random') {
    type_sort.value = 'random'
  } else {
    type_sort.value = null
  }

  if (searchTerm && uuid.value) {
    await getSentences(searchTerm, 0, animeId ? animeId : undefined, uuid.value, selected_season.value, selectedEpisodes.value);
  } else if (searchTerm && !uuid.value) {
    querySearch.value = searchTerm;
    await getSentences(searchTerm, 0, animeId ? animeId : undefined, undefined, selected_season.value, selectedEpisodes.value);
  } else if (uuid.value) {
    await getSentences('', '', animeId ? animeId : undefined, uuid.value, selected_season.value, selectedEpisodes.value);
  }

  // Observa el elemento al final del contenedor solo si no hay un UUID
  const observer = new IntersectionObserver(loadMoreSentences, {
    root: null,
    rootMargin: '1400px',
    threshold: 0.5
  })

  const sentinel = document.getElementById('sentinel')
  observer.observe(sentinel)
  isMounted.value = true
})

const selectedEpisodes = ref([]);

const toggleEpisodeSelection = (episode) => {
  const episodesOfSeason = animeMap[anime_id]?.season_with_episode_hits[selected_season] || {};

  if (episode === 'all') {
    if (selectedEpisodes.value.length === Object.keys(episodesOfSeason).length) {
      selectedEpisodes.value = [];
    } else {
      selectedEpisodes.value = Object.keys(episodesOfSeason).map(num => parseInt(num));
    }
  } else {
    const episodeNum = parseInt(episode);
    const index = selectedEpisodes.value.indexOf(episodeNum);
    if (index === -1) {
      selectedEpisodes.value.push(episodeNum);
    } else {
      selectedEpisodes.value.splice(index, 1);
    }
  }
  updateURL();
};


const toggleSeasonSelection = (season) => {
  selectedEpisodes.value = []
  if (season === 'all') {
    selected_season.value = null;
  } else {
    selected_season.value = season;
  }
  updateURL();
};

const updateURL = () => {

  const searchTerm = querySearch.value.trim()

  let queryParameters = { query: searchTerm }

  if (['asc', 'desc'].includes(type_sort.value)) {
    queryParameters.sort = type_sort.value
  }

  if (type_sort.value === 'random') {
    queryParameters.sort = type_sort.value
  }

  if (anime_id.value !== 0) {
    queryParameters.anime_id = anime_id.value
  }

  if (selected_season.value) {
    queryParameters.season = selected_season.value;
  }

  if (selectedEpisodes.value.length > 0) {
    queryParameters.episode = selectedEpisodes.value.join(',');
  }

  if (typeof exact_match.value !== 'undefined' && exact_match.value !== null) {
    queryParameters.exact_match = exact_match.value ? 'true' : 'false'
  }

  router.push({ query: queryParameters })
};

const isSelected = (episode) => {
  return selectedEpisodes.value.includes(parseInt(episode));
};

const isSelectedSeason = (season) => {
  return selected_season.value == season;
};

const filteredAnimes = computed(() => {
  const filteredItems = statistics.value.filter((item) => {
    const categoryFilter = categorySelected.value == 0 || item.category === categorySelected.value;
    const nameFilterEnglish = item.name_anime_en.toLowerCase().includes(querySearchAnime.value.toLowerCase());
    const nameFilterJapanese = item?.name_anime_jp?.toLowerCase().includes(querySearchAnime.value.toLowerCase());
    const nameFilterRomaji = item?.name_anime_romaji?.toLowerCase().includes(querySearchAnime.value.toLowerCase());

    return (categoryFilter && (nameFilterEnglish || nameFilterJapanese || nameFilterRomaji));
  })

  if (categorySelected.value) {
    filteredItems.unshift({
      anime_id: 0,
      name_anime_en: t('searchpage.main.labels.all'),
      amount_sentences_found: filteredItems.reduce((a, b) => a + parseInt(b.amount_sentences_found), 0)
    });
  }

  if (filteredItems.length === 0) {
    return [{ name_anime_en: t('searchpage.main.labels.noresults') }]
  }

  const sortedItems = filteredItems.sort((a, b) => {
    const nameA = a.name_anime_en.toLowerCase()
    const nameB = b.name_anime_en.toLowerCase()

    // If "Todo" is present, it should always appear at the top (index -1)
    if (nameA === t('searchpage.main.labels.all').toLowerCase()) return -1
    if (nameB === t('searchpage.main.labels.all').toLowerCase()) return 1

    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })

  return sortedItems
})

const filterAnime = async (new_anime_id) => {
  // Si el anime seleccionado es el mismo que el anime actual, no hagas nada
  if (anime_id.value === null || anime_id.value === undefined) {
    anime_id.value = 0
  }
  if (parseInt(new_anime_id) === parseInt(anime_id.value)) {
    return
  }

  const searchTerm = querySearch.value.trim()

  if (searchTerm !== '') {
    next_cursor.value = null
    sentences.value = []
    window.scrollTo(0, 0)

    let queryParameters = { query: searchTerm }

    if (['asc', 'desc'].includes(type_sort.value)) {
      queryParameters.sort = type_sort.value
    }

    if (type_sort.value === 'random') {
      queryParameters.sort = type_sort.value
    }

    if (new_anime_id !== 0) {
      queryParameters.anime_id = new_anime_id
    }

    if (typeof exact_match.value !== 'undefined' && exact_match.value !== null) {
      queryParameters.exact_match = exact_match.value ? 'true' : 'false'
    }

    selected_season.value = null
    selectedEpisodes.value = []
    await router.push({ query: queryParameters })

    anime_id.value = new_anime_id
  }
}

// Invoca a la API para obtener la lista de oraciones de forma recursiva
const getSentences = async (searchTerm, cursor, animeId, uuid, season, episodes) => {
  isLoading.value = true
  error_connection.value = false
  anime_id.value = animeId

  selected_season.value = selected_season.value === 'all' ? null : parseInt(season)
  selectedEpisodes.value = selectedEpisodes.value === 'all' ? null : selectedEpisodes.value

  let response = null

  const body = {
    query: searchTerm,
    anime_id: anime_id.value,
    exact_match: exactMatchFromStore.value ? 1 : 0, // Normalize exact match value from true/false to 1/0
    uuid: uuid,
    limit: 20,
    content_sort: type_sort.value,
    random_seed: random_seed.value,
    season: selected_season.value ? [selected_season.value] : null,
    episode: selectedEpisodes.value.length > 0 ? selectedEpisodes.value : null,
    category: categorySelected.value ? [categorySelected.value] : null
  }

  // Calls to backend fail if this is passed to the body when null or undefined
  if (cursor) body.cursor = cursor

  try {
    response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + 'search/media/sentence', {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
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
  category_statistics = response.categoryStatistics

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

const animeMap = computed(() => {
  return statistics.value.reduce((map, anime) => {
    map[anime.anime_id] = anime;
    return map;
  }, {});
});

// Función para cargar más elementos al final de la página
const loadMoreSentences = async (entries) => {
  if (entries[0].isIntersecting && next_cursor.value && !isLoading.value) {
    await getSentences(querySearch.value, next_cursor.value, anime_id.value, undefined, selected_season.value, selectedEpisodes.value)
  }
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
  const options = {
    timeout: 3000,
    position: 'bottom-right'
  }

  isModalReportActive.value = true
  currentSentence.value = item

  let activatorReportModal = document.querySelector(
    'button[data-hs-overlay="#hs-vertically-centered-scrollable-modal2"]'
  )

  if (!store.isLoggedIn) {
    const message = t('Debes iniciar sesión para reportar una oración')
    return toast.error(message, options)
  }

  if (activatorReportModal) {
    activatorReportModal.click()
  }
}

const showModalBatchSearch = async () => {
  isModalBatchSearchActive.value = true
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
    await navigator.clipboard.writeText(`${window.location.origin}/search/sentences?uuid=${sentence.segment_info.uuid}`)
    const message = t('searchpage.main.labels.copiedsharingurl')
    toast.success(message, options)
  } catch (error) {
    const message = t('searchpage.main.labels.errorcopiedsharingurl')
    toast.error(message, options)
  }
}

const categoryFilter = async (category) => {
  categorySelected.value = category
  next_cursor.value = null
  sentences.value = []
  window.scrollTo(0, 0)
  await getSentences(querySearch.value, next_cursor.value, anime_id.value, undefined, selected_season.value, selected_episode.value, categorySelected.value)
}


const sortFilter = async (new_type) => {
  if (new_type === type_sort.value) {
    next_cursor.value = null
    sentences.value = []
    random_seed.value = Math.floor(Math.random() * 65535)
    window.scrollTo(0, 0)
    await getSentences(querySearch.value, next_cursor.value, anime_id.value, undefined, selected_season.value, selected_episode.value)
    return
  }

  type_sort.value = new_type
  next_cursor.value = null
  sentences.value = []
  window.scrollTo(0, 0)

  let queryParameters = { query: querySearch.value }

  if (type_sort.value !== 'none') {
    queryParameters.sort = type_sort.value
  }

  if (typeof exact_match.value !== 'undefined' && exact_match.value !== null) {
    queryParameters['exact_match'] = exact_match.value ? 'true' : 'false'
  }

  if (anime_id.value !== 0) {
    queryParameters.anime_id = anime_id.value
  }

  await router.push({ path: '/search/sentences', query: queryParameters })
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

const addToLastAnkiCard = async (sentence) => {
  await addToAnki(sentence, null)
}

const addToAnkiCardID = async (sentence) => {
  const cardId = prompt('Introduce el ID de la tarjeta de Anki')
  if (cardId) {
    await addToAnki(sentence, cardId)
  }
}

const addToAnki = async (sentence, id) => {
  const options = {
    timeout: 3000,
    position: 'bottom-right'
  }
  const settings = JSON.parse(localStorage.getItem('settings'))
  const extensionId = import.meta.env.VITE_APP_EXTENSION_KEY
  const request = {
    action: 'updateAnkiCard',
    settings: settings,
    sentence: sentence,
    id: parseInt(id)
  }

  chrome.runtime.sendMessage(extensionId, request, (response) => {
    console.log(response)
    if (response.error) {
      const message = 'No se ha podido añadir la tarjeta en Anki. Error: ' + response.error
      toast.error(message, options)
    } else {
      const message = 'La tarjeta ha sido añadida en Anki'
      toast.success(message, options)
    }
  })
}

const setBarHeightValue = async (value) => {
  searchBarHeight.value = value
}

// NO QUITAR, inicializa el componente para que no falle
try {
  contextactive.value.getContextSentence(currentSentence.value)
} catch (error) {
  isModalContextActive.value = true
  isModalReportActive.value = true
}

let placeholder_search2 = t('searchpage.main.labels.searchbar')
</script>
<template>
  <div>
    <SearchBarSentences :isLoading="isLoading" :error_connection="error_connection"
      @searchBarHeight="setBarHeightValue" />
    <div class="flex flex-row lg:w-11/12 mx-auto mb-20" @scroll="loadMoreSentences">
      <div class="container  sm:max-w-screen-lg md:max-w-full w-100 mx-auto flex flex-col">
        <div class="pb-4" v-if="category_statistics.length > 0">
          <div id="tabs-container" class="mt-2">
            <div id="tab-headers">
              <ul class="tab-titles">
                <li @click="categoryFilter(0)" :class="{ active: categorySelected === 0 }"
                  v-if="category_statistics.some(item => item.category === 1 && item.count > 0)">
                  Todo
                  <span
                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                    <span v-if="category_statistics.reduce((total, item) => total + item.count, 0)">{{
                      category_statistics.reduce((total, item) => total + item.count, 0) }}</span>
                  </span>
                </li>
                <li @click="categoryFilter(1)" :class="{ active: categorySelected === 1 }"
                  v-if="category_statistics.some(item => item.category === 1 && item.count > 0)">
                  Anime
                  <span
                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                    <span v-if="category_statistics.find(item => item.category === 1).count">{{
                      category_statistics.find(item => item.category === 1).count }}</span>
                  </span>
                </li>
                <li @click="categoryFilter(3)" :class="{ active: categorySelected === 3 }"
                  v-if="category_statistics.some(item => item.category === 3 && item.count > 0)">
                  Jdrama
                  <span
                    class="ml-2.5 bg-gray-100 text-gray-800 text-sm  me-2 px-2.5 py-1 rounded-xl dark:bg-white/20 dark:text-gray-300">
                    <span v-if="category_statistics.find(item => item.category === 3).count">{{
                      category_statistics.find(item => item.category === 3).count }}</span>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div class="">
          <div v-if="sentences.length > 0" v-for="(sentence, index) in sentences"
            class="flex group  flex-col md:flex-row duration-300 sm:hover:bg-sgray2/30 sm:px-4 overflow-hidden border-b py-6 mr-0 lg:mr-10 border-sgray2 w-100">
            <div class="h-auto shrink-0 w-auto md:w-[26em] md:h-[15em]">
              <img v-lazy="sentence.media_info.path_image + '?width=960&height=540'"
                class="inset-0 h-full w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
                :key="sentence.media_info.path_image" @click="ampliarImagen(sentence.media_info.path_image)" />
            </div>
            <div class="w-full py-6 sm:py-2 px-6 text-white flex flex-col justify-between">
              <div className="inline-flex items-start justify-center">
                <button class="focus:outline-none bg-sgray hover:bg-sgrayhover p-1.5 xxm:p-3 rounded-xl items-center"
                  @click="playSound(sentence.media_info.path_audio)">
                  <svg aria-hidden="true" class="w-6 xxm:w-8 mx-auto ml-0.5 fill-white text-white dark:text-white"
                    viewBox="0 0 130 130" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z">
                    </path>
                  </svg>
                </button>
                <div class="flex flex-1 relative items-start justify-start my-auto">
                  <h3
                    class="font-semibold ml-2 items-start text-xl xxl:text-2xl xxl:font-normal xxm:text-3xl leading-tight">
                    <span v-html="sentence.segment_info.content_jp_highlight
                      ? sentence.segment_info.content_jp_highlight
                      : sentence.segment_info.content_jp
                      "></span>
                  </h3>
                </div>
              </div>
              <h4 class="font-normal text-sm xxl:text-base xxm:text-2xl leading-tight my-4">
                <span
                  class="bg-gray-100 mb-1 text-gray-800 text-xs xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sgray dark:text-gray-400 border border-gray-700">
                  {{ t('searchpage.main.labels.translation') }}
                </span>
                <span v-if="sentence.segment_info.is_nsfw"
                  class="bg-gray-100 mb-1 text-gray-800 text-xs xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/30 dark:text-gray-400 border border-gray-700">NSFW
                </span>
                <ul class="ml-5 xxm:ml-8 list-disc text-gray-400">
                  <li class="my-2 text-sm xxl:text-base xxm:text-2xl" v-for="segment in orderedSegments"
                    :key="segment.content">
                    <span v-html="normalizeSentence(
                      sentence.segment_info[segment.highlight]
                        ? sentence.segment_info[segment.highlight]
                        : sentence.segment_info[segment.content]
                    )
                      "></span>
                    <div v-if="sentence.segment_info[segment.mt]" class="hs-tooltip inline-block">
                      <BaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4"
                        h="h-4" size="19" class="ml-2 hs-tooltip-toggle" />
                      <span
                        class="hs-tooltip-content hs-tooltip-shown:opacity-90 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-[#181818] shadow-sm rounded-md text-white"
                        role="tooltip">
                        {{ t('searchpage.main.labels.mtTooltip') }}
                      </span>
                    </div>
                  </li>
                </ul>
              </h4>
              <div class="flex flex-wrap">
                <div>
                  <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                    <button id="hs-dropdown-with-title" type="button"
                      class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium text-sgray shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:border-sgrayhover dark:text-gray-300 dark:hover:text-white">
                      <svg class="flex-none" width="20" height="20" viewBox="0 0 24 24" fill-opacity="0"
                        stroke="currentColor">
                        <path xmlns="http://www.w3.org/2000/svg"
                          d="M13 3H8.2C7.0799 3 6.51984 3 6.09202 3.21799C5.71569 3.40973 5.40973 3.71569 5.21799 4.09202C5 4.51984 5 5.0799 5 6.2V17.8C5 18.9201 5 19.4802 5.21799 19.908C5.40973 20.2843 5.71569 20.5903 6.09202 20.782C6.51984 21 7.0799 21 8.2 21H12M13 3L19 9M13 3V7.4C13 7.96005 13 8.24008 13.109 8.45399C13.2049 8.64215 13.3578 8.79513 13.546 8.89101C13.7599 9 14.0399 9 14.6 9H19M19 9V12M17 19H21M19 17V21"
                          stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>

                      {{ t('searchpage.main.buttons.add') }}

                      <svg class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-gray-300" width="16" height="16"
                        viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 5L8.16086 10.6869C8.35239 10.8637 8.64761 10.8637 8.83914 10.6869L15 5"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>

                    <div
                      class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                      aria-labelledby="hs-dropdown-with-title">
                      <div class="py-2 first:pt-0 last:pb-0">
                        <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-white/60">
                          {{ t('searchpage.main.labels.options') }}
                        </span>
                        <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="addToLastAnkiCard(sentence)">
                          <BaseIcon :path="mdiStarShootingOutline" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
                          Anki (Guardado rápido)
                        </a>
                        <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="addToAnkiCardID(sentence)">
                          <BaseIcon :path="mdiStarShootingOutline" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
                          Anki (Seleccionar ID)
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                    <button id="hs-dropdown-with-title" type="button"
                      class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-sgray shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:border-sgrayhover dark:text-gray-300 dark:hover:text-white">
                      <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path fill-rule="evenodd"
                          d="M7.646 10.854a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L8.5 9.293V5.5a.5.5 0 0 0-1 0v3.793L6.354 8.146a.5.5 0 1 0-.708.708l2 2z" />
                        <path
                          d="M4.406 3.342A5.53 5.53 0 0 1 8 2c2.69 0 4.923 2 5.166 4.579C14.758 6.804 16 8.137 16 9.773 16 11.569 14.502 13 12.687 13H3.781C1.708 13 0 11.366 0 9.318c0-1.763 1.266-3.223 2.942-3.593.143-.863.698-1.723 1.464-2.383zm.653.757c-.757.653-1.153 1.44-1.153 2.056v.448l-.445.049C2.064 6.805 1 7.952 1 9.318 1 10.785 2.23 12 3.781 12h8.906C13.98 12 15 10.988 15 9.773c0-1.216-1.02-2.228-2.313-2.228h-.5v-.5C12.188 4.825 10.328 3 8 3a4.53 4.53 0 0 0-2.941 1.1z" />
                      </svg>

                      {{ t('searchpage.main.buttons.download') }}

                      <svg class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-gray-300" width="16" height="16"
                        viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 5L8.16086 10.6869C8.35239 10.8637 8.64761 10.8637 8.83914 10.6869L15 5"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>

                    <div
                      class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                      aria-labelledby="hs-dropdown-with-title">
                      <div class="py-2 first:pt-0 last:pb-0">
                        <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-white/60">
                          {{ t('searchpage.main.labels.multimedia') }}
                        </span>
                        <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="
                            downloadAudioOrImage(
                              sentence.media_info.path_video,
                              sentence.media_info.path_video.split('/').pop()
                            )
                            ">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25"
                            fill="none">
                            <path :d="mdiFileVideo" stroke="white" stroke-miterlimit="10" stroke-linecap="round"
                              stroke-linejoin="round" />
                          </svg>
                          {{ t('searchpage.main.buttons.video') }}
                        </a>
                        <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="
                            downloadAudioOrImage(
                              sentence.media_info.path_image,
                              sentence.media_info.path_image.split('/').pop()
                            )
                            ">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25"
                            fill="none">
                            <path
                              d="M21 22H3C2.72 22 2.5 21.6517 2.5 21.2083V3.79167C2.5 3.34833 2.72 3 3 3H21C21.28 3 21.5 3.34833 21.5 3.79167V21.2083C21.5 21.6517 21.28 22 21 22Z"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path d="M4.5 19.1875L9.66 12.6875C9.86 12.4375 10.24 12.4375 10.44 12.6875L15.6 19.1875"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path
                              d="M16.2 16.6975L16.4599 16.3275C16.6599 16.0775 17.0399 16.0775 17.2399 16.3275L19.4999 19.1875"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path
                              d="M17.2046 9.54315C17.2046 10.4294 16.4862 11.1478 15.6 11.1478C14.7138 11.1478 13.9954 10.4294 13.9954 9.54315C13.9954 8.65695 14.7138 7.93854 15.6 7.93854C16.4862 7.93854 17.2046 8.65695 17.2046 9.54315Z"
                              stroke="#white" />
                          </svg>
                          {{ t('searchpage.main.buttons.image') }}
                        </a>
                        <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="
                            downloadAudioOrImage(
                              sentence.media_info.path_audio,
                              sentence.media_info.path_audio.split('/').pop()
                            )
                            ">
                          <svg class="flex-none" width="16" height="16" viewBox="0 0 130 130" fill="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z">
                            </path>
                          </svg>
                          {{ t('searchpage.main.buttons.audio') }}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                    <button id="hs-dropdown-with-title" type="button"
                      class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800">
                      <svg width="1em" height="1em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
                        focusable="false" class="rs-icon" aria-label="copy" data-category="action">
                        <path
                          d="M13 11.5a.5.5 0 01.5-.5h.5a1 1 0 001-1V2a1 1 0 00-1-1H6a1 1 0 00-1 1v.5a.5.5 0 01-1 0V2a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-.5a.5.5 0 01-.5-.5z">
                        </path>
                        <path
                          d="M2 5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V6a1 1 0 00-1-1H2zm0-1h8a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V6a2 2 0 012-2z">
                        </path>
                      </svg>
                      {{ t('searchpage.main.buttons.copyclipboard') }}

                      <svg class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-gray-300" width="16" height="16"
                        viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 5L8.16086 10.6869C8.35239 10.8637 8.64761 10.8637 8.83914 10.6869L15 5"
                          stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>
                    <div
                      class="z-30 hs-dropdown-menu transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                      aria-labelledby="hs-dropdown-with-title">
                      <div class="py-2 first:pt-0 last:pb-0">
                        <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-white/60">
                          Multimedia
                        </span>
                        <a @click="copyToClipboard(sentence.media_info.path_video)"
                          class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25"
                            fill="none">
                            <path :d="mdiFileVideo" stroke="white" stroke-miterlimit="10" stroke-linecap="round"
                              stroke-linejoin="round" />
                          </svg>
                          {{ t('searchpage.main.buttons.video') }}
                        </a>
                        <a @click="copyToClipboard(sentence.media_info.path_image)"
                          class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25"
                            fill="none">
                            <path
                              d="M21 22H3C2.72 22 2.5 21.6517 2.5 21.2083V3.79167C2.5 3.34833 2.72 3 3 3H21C21.28 3 21.5 3.34833 21.5 3.79167V21.2083C21.5 21.6517 21.28 22 21 22Z"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path d="M4.5 19.1875L9.66 12.6875C9.86 12.4375 10.24 12.4375 10.44 12.6875L15.6 19.1875"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path
                              d="M16.2 16.6975L16.4599 16.3275C16.6599 16.0775 17.0399 16.0775 17.2399 16.3275L19.4999 19.1875"
                              stroke="white" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                            <path
                              d="M17.2046 9.54315C17.2046 10.4294 16.4862 11.1478 15.6 11.1478C14.7138 11.1478 13.9954 10.4294 13.9954 9.54315C13.9954 8.65695 14.7138 7.93854 15.6 7.93854C16.4862 7.93854 17.2046 8.65695 17.2046 9.54315Z"
                              stroke="#white" />
                          </svg>
                          {{ t('searchpage.main.buttons.image') }}
                        </a>
                        <a @click="copyToClipboard(sentence.media_info.path_audio)"
                          class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                          <svg class="flex-none" width="16" height="16" viewBox="0 0 130 130" fill="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z">
                            </path>
                          </svg>
                          {{ t('searchpage.main.buttons.audio') }}
                        </a>
                      </div>
                      <div class="py-2 first:pt-0 last:pb-0">
                        <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-white/60">
                          {{ t('searchpage.main.labels.text') }}
                        </span>
                        <a @click="copyToClipboard(sentence.segment_info.content_jp)"
                          class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                          <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path
                              d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                            <path
                              d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                          </svg>
                          {{ t('searchpage.main.buttons.jpsentence') }}
                        </a>
                        <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="copyToClipboard(normalizeSentence(sentence.segment_info.content_en))">
                          <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path
                              d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                            <path
                              d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                          </svg>
                          {{ t('searchpage.main.buttons.ensentence') }}
                        </a>
                        <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="copyToClipboard(normalizeSentence(sentence.segment_info.content_es))">
                          <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path
                              d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                            <path
                              d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                          </svg>
                          {{ t('searchpage.main.buttons.essentence') }}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="relative inline-flex mb-2 mr-2">
                    <button @click="showModalContext(sentence)"
                      data-hs-overlay="#hs-vertically-centered-scrollable-modal" type="button"
                      class="dark:bg-sgray outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:text-gray-300 dark:hover:text-white">
                      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"
                        class="rs-icon w-4 h-[22px]">
                        <path
                          d="M4 2a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2H4zm0-1h8a3 3 0 013 3v8a3 3 0 01-3 3H4a3 3 0 01-3-3V4a3 3 0 013-3z">
                        </path>
                        <path
                          d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z">
                        </path>
                      </svg>
                      {{ t('searchpage.main.buttons.context') }}
                    </button>
                  </div>
                </div>

                <div>
                  <div class="hs-dropdown relative inline-flex mb-2 mr-2">
                    <button id="hs-dropdown-with-title" type="button"
                      class="border-transparent dark:bg-sgray dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800">
                      <svg class="hs-dropdown-open:rotate-180 w-5 h-5 rotate-90 fill-white text-gray-300"
                        viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M14 5C14 6.10457 13.1046 7 12 7C10.8954 7 10 6.10457 10 5C10 3.89543 10.8954 3 12 3C13.1046 3 14 3.89543 14 5Z" />
                        <path
                          d="M14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12Z" />
                        <path
                          d="M12 21C13.1046 21 14 20.1046 14 19C14 17.8954 13.1046 17 12 17C10.8954 17 10 17.8954 10 19C10 20.1046 10.8954 21 12 21Z" />
                      </svg>
                    </button>

                    <div
                      class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                      aria-labelledby="hs-dropdown-with-title">
                      <div class="py-2 first:pt-0 last:pb-0">
                        <span class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-white/60">
                          {{ t('searchpage.main.labels.options') }}
                        </span>
                        <a v-if="user?.roles?.includes(1)" @click="currentSentence = sentence"
                          data-hs-overlay="#hs-vertically-centered-scrollable-editsentencemodal" type="button"
                          class="flex items-center w-full cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                          <BaseIcon display="inline-block" vertical-align="top" :path="mdiPencilOutline" fill="#DDDF"
                            w="w-5" h="h-5" size="20" class="text-center" />
                          Editar oracion
                        </a>
                        <a class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-redalert dark:hover:text-gray-300"
                          @click="showModalReport(sentence)">
                          <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20"
                            height="20" class="fill-white" version="1.1" id="Layer_1" viewBox="0 0 512 512">
                            <g>
                              <g>
                                <path
                                  d="M505.403,406.394L295.389,58.102c-8.274-13.721-23.367-22.245-39.39-22.245c-16.023,0-31.116,8.524-39.391,22.246    L6.595,406.394c-8.551,14.182-8.804,31.95-0.661,46.37c8.145,14.42,23.491,23.378,40.051,23.378h420.028    c16.56,0,31.907-8.958,40.052-23.379C514.208,438.342,513.955,420.574,505.403,406.394z M477.039,436.372    c-2.242,3.969-6.467,6.436-11.026,6.436H45.985c-4.559,0-8.784-2.466-11.025-6.435c-2.242-3.97-2.172-8.862,0.181-12.765    L245.156,75.316c2.278-3.777,6.433-6.124,10.844-6.124c4.41,0,8.565,2.347,10.843,6.124l210.013,348.292    C479.211,427.512,479.281,432.403,477.039,436.372z" />
                              </g>
                            </g>
                            <g>
                              <g>
                                <path
                                  d="M256.154,173.005c-12.68,0-22.576,6.804-22.576,18.866c0,36.802,4.329,89.686,4.329,126.489    c0.001,9.587,8.352,13.607,18.248,13.607c7.422,0,17.937-4.02,17.937-13.607c0-36.802,4.329-89.686,4.329-126.489    C278.421,179.81,268.216,173.005,256.154,173.005z" />
                              </g>
                            </g>
                            <g>
                              <g>
                                <path
                                  d="M256.465,353.306c-13.607,0-23.814,10.824-23.814,23.814c0,12.68,10.206,23.814,23.814,23.814    c12.68,0,23.505-11.134,23.505-23.814C279.97,364.13,269.144,353.306,256.465,353.306z" />
                              </g>
                            </g>
                          </svg>
                          {{ t('searchpage.main.buttons.report') }}
                        </a>
                        <a class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                          @click="getSharingURL(sentence)">
                          <svg class="fill-white" xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                            viewBox="0 0 50 50">
                            <path
                              d="M31.2,14.2,41,24.1l-9.8,9.8V26.8L27,27c-6.8.3-12,1-16.1,2.4,3.6-3.8,9.3-6.8,16.7-7.5l3.6-.3V14.2M28.3,6a1.2,1.2,0,0,0-1.1,1.3V17.9C12,19.4,2.2,29.8,2,40.3c0,.6.2,1,.6,1s.7-.3,1.1-1.1c2.4-5.4,7.8-8.5,23.5-9.2v9.7A1.2,1.2,0,0,0,28.3,42a.9.9,0,0,0,.8-.4L45.6,25.1a1.5,1.5,0,0,0,0-2L29.1,6.4a.9.9,0,0,0-.8-.4Z" />
                          </svg>
                          {{ t('searchpage.main.buttons.share') }}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="flex justify-left">
                <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold mt-2">
                  {{ sentence.basic_info.name_anime_en }} &bull;
                  <template v-if="sentence.basic_info.season === 0"> {{ t('searchpage.main.labels.movie') }} </template>
                  <template v-else>
                    {{ t('searchpage.main.labels.season') }} {{ sentence.basic_info.season }},
                    {{ t('searchpage.main.labels.episode') }} {{ sentence.basic_info.episode }}
                  </template>
                </p>
              </div>
            </div>
          </div>

          <div
            v-else-if="sentences.length === 0 && querySearch !== '' && isLoading === true && error_connection === false">
            <div class="" v-for="i in 8" :key="i">
              <div role="status"
                class="border-sgray2 border-b space-y-8 mt-6 animate-pulse md:space-y-0 md:space-x-8 md:flex md:items-center">
                <div
                  class="flex mb-10 items-center justify-center bg-gray-300 rounded h-64 w-auto md:w-5/12 dark:bg-graypalid">
                  <svg class="w-12 h-12 text-gray-200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
                    fill="currentColor" viewBox="0 0 640 512">
                    <path
                      d="M480 80C480 35.82 515.8 0 560 0C604.2 0 640 35.82 640 80C640 124.2 604.2 160 560 160C515.8 160 480 124.2 480 80zM0 456.1C0 445.6 2.964 435.3 8.551 426.4L225.3 81.01C231.9 70.42 243.5 64 256 64C268.5 64 280.1 70.42 286.8 81.01L412.7 281.7L460.9 202.7C464.1 196.1 472.2 192 480 192C487.8 192 495 196.1 499.1 202.7L631.1 419.1C636.9 428.6 640 439.7 640 450.9C640 484.6 612.6 512 578.9 512H55.91C25.03 512 .0006 486.1 .0006 456.1L0 456.1z" />
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
          <div id="sentinel"></div>
          <div v-if="isLoading && sentences.length > 0 && error_connection === false" class="text-center">
            <div
              class="animate-spin inline-block w-6 h-6 my-5 border-[3px] border-current border-t-transparent text-blue-600 rounded-full"
              role="status" aria-label="loading">
              <span class="sr-only">Loading...</span>
            </div>
          </div>
        </div>
      </div>
      <ContextSentence v-if="isModalContextActive" :item="currentSentence" ref="contextactive" />
      <ReportModal v-if="isModalReportActive" :item="currentSentence" />
      <BatchSearchModal v-if="isModalBatchSearchActive" />
      <EditSentenceModal :item="currentSentence" />

      <div>
        <SidebarAnime :list="statistics" :sentences="sentences" :type_sort="type_sort" @filter-anime="filterAnime"
          @filter-anime-length="sortFilter" />
      </div>
      <div v-if="statistics.length > 1 && !uuid">
        <div id="search-anime-disabled"
          :class="{ 'xl:w-[21rem] xxl:w-[30rem]': filtersVisible, 'xl:w-[4rem] xxl:w-[10rem]': !filtersVisible }"
          class="hidden ml-6 xl:flex flex-col py-7"
          :style="{ position: 'relative', top: searchBarHeight + 'px-disabled' }">

          <button type="button" @click="filtersVisible = !filtersVisible"
            class="py-3.5 duration-300 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-sm xxl:text-base xxm:text-2xl text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white">
            <BaseIcon :path="filtersVisible ? mdiArrowCollapseRight : mdiArrowCollapseLeft" w="w-5 md:w-5"
              h="h-5 md:h-5" size="20" :class="{ 'mr-3': filtersVisible, '': !filtersVisible }" />

            <div v-if="filtersVisible" class="mr-2">Ocultar Filtros</div>
          </button>


          <div v-if="filtersVisible" class="w-full flex flex-col relative">
            <div class="relative flex pb-4 items-center">
              <div class="flex-grow border-t border-sgray2"></div>
              <div class="flex-grow border-t border-sgray2"></div>
            </div>
            <div class="inline-flex space-x-2">
              <div class="hs-dropdown relative inline-block w-full z-20">
                <button id="hs-dropdown-default" type="button"
                  class="hs-dropdown-toggle duration-300 py-3.5 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-sm xxl:text-base xxm:text-2xl text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white">
                  <svg aria-hidden="true" class="w-5 h-5 mx-2 fill-white text-white dark:text-white" viewBox="0 0 18 18"
                    xmlns="http://www.w3.org/2000/svg">
                    <path stroke-width="0.5" stroke="white" xmlns="http://www.w3.org/2000/svg" id="Path_36"
                      data-name="Path 36"
                      d="M28.854,12.146a.5.5,0,0,1,0,.708l-3,3a.518.518,0,0,1-.163.109.5.5,0,0,1-.382,0,.518.518,0,0,1-.163-.109l-3-3a.5.5,0,0,1,.708-.708L25,14.293V.5a.5.5,0,0,1,1,0V14.293l2.146-2.147A.5.5,0,0,1,28.854,12.146Zm9-9-3-3a.518.518,0,0,0-.163-.109.505.505,0,0,0-.382,0,.518.518,0,0,0-.163.109l-3,3a.5.5,0,0,0,.708.708L34,1.707V15.5a.5.5,0,0,0,1,0V1.707l2.146,2.147a.5.5,0,1,0,.708-.708Z"
                      transform="translate(-22)" />
                  </svg>

                  <div v-if="filtersVisible">
                    {{ t('searchpage.main.buttons.sortmain') }}
                    <span v-if="type_sort === 'asc'">({{ t('searchpage.main.buttons.sortlengthmin') }})</span>
                    <span v-else-if="type_sort === 'desc'">({{ t('searchpage.main.buttons.sortlengthmax') }})</span>
                    <span v-else-if="type_sort === 'random'">({{ t('searchpage.main.buttons.sortrandom') }})</span>
                  </div>
                  <svg v-if="filtersVisible" class="hs-dropdown-open:rotate-180 w-2.5 h-2.5 text-white" width="16"
                    height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 5L8.16086 10.6869C8.35239 10.8637 8.64761 10.8637 8.83914 10.6869L15 5"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </button>

                <div
                  class="hs-dropdown-menu transition-[opacity,margin] duration-[0.1ms] hs-dropdown-open:opacity-100 opacity-0 w-2/12 hidden z-10 mt-2 min-w-[15rem] bg-white shadow-md rounded-lg p-2 dark:bg-sgray dark:border dark:border-gray-600 dark:divide-gray-700"
                  aria-labelledby="hs-dropdown-default">
                  <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    @click="sortFilter('none')">
                    <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path
                        d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                      <path
                        d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                    </svg>
                    {{ t('searchpage.main.buttons.sortlengthnone') }}
                  </a>
                  <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    @click="sortFilter('asc')">
                    <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path
                        d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                      <path
                        d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                    </svg>
                    {{ t('searchpage.main.buttons.sortlengthmin') }}
                  </a>
                  <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    @click="sortFilter('desc')">
                    <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path
                        d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                      <path
                        d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                    </svg>
                    {{ t('searchpage.main.buttons.sortlengthmax') }}
                  </a>
                  <a class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    @click="sortFilter('random')">
                    <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path
                        d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                      <path
                        d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                    </svg>
                    {{ t('searchpage.main.buttons.sortrandom') }}
                  </a>
                </div>
              </div>

              <button type="button" v-if="type_sort === 'random'" @click="sortFilter('random')"
                class="py-2 duration-300 px-2 mb-4 w-auto mx-auto inline-flex  justify-center items-center gap-= border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-xs text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white">
                <BaseIcon :path="mdiRefresh" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="mx-2" />
              </button>
            </div>
            <div v-if="filtersVisible">
              <ul
                class="z-20 divide-y divide-gray-600 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-sgray dark:border-gray-600 dark:text-white">
                <div
                  class="flex items-center w-full px-4 py-2 text-center justify-center rounded-t-lg rounded-l-lg dark:border-gray-600">
                  <span class="font-medium text-base">{{ t('searchpage.main.labels.contentList') }}</span>
                </div>
                <div class="flex flex-inline">
                  <input type="search" v-model="querySearchAnime" id="default-search2" autocomplete="off"
                    class="block w-full p-4 pl-4 text-sm xxl:text-base xxm:text-2xl text-gray-900 border-none dark:bg-sgray dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
                    :placeholder="placeholder_search2" required />
                  <div class="absolute z-10 right-0 mr-2 mt-4 inline-flex items-center pr-3 pointer-events-none">
                    <svg aria-hidden="true" class="w-5 h-5 text-white/60 dark:text-gray-400" fill="none"
                      stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                  </div>
                </div>
                <div class="overflow-auto snap-y max-h-[50vh]">
                  <li class="snap-start" v-for="item in filteredAnimes" :key="item.anime_id">
                    <button @click="filterAnime(item.anime_id, item.name_anime_en)"
                      :class="{ 'bg-sgrayhover': item.anime_id == anime_id }"
                      class="flex border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                      <span :class="{ '': item.anime_id == anime_id }">{{ item.name_anime_en }}</span>
                      <span
                        v-if="item.name_anime_en.toLowerCase() !== t('searchpage.main.labels.noresults').toLowerCase()"
                        class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">
                        {{ item.amount_sentences_found }}
                      </span>
                    </button>
                  </li>
                </div>

                <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600"></div>
              </ul>
            </div>
            <div v-if="animeMap[anime_id] && anime_id !== 0 && filtersVisible" class="relative flex py-4 items-center">
              <div class="flex-grow border-t border-sgray2"></div>
              <div class="flex-grow border-t border-sgray2"></div>
            </div>
            <div class="pb-4" v-if="animeMap[anime_id] && anime_id !== 0 && filtersVisible">
              <ul
                class="z-20 divide-y divide-gray-600 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-sgray dark:border-gray-600 dark:text-white">
                <div
                  class="flex items-center w-full px-4 py-2 text-center justify-center rounded-t-lg rounded-l-lg dark:border-gray-600">
                  <span class="font-medium text-base">Temporadas</span>
                </div>
                <div class="overflow-auto snap-y max-h-[18vh]">
                  <button @click="toggleSeasonSelection('all')"
                    :class="{ 'bg-sgrayhover': isNaN(selected_season) || selected_season === null }"
                    class="flex border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                    <span>{{ t('searchpage.main.labels.all') }}</span>
                  </button>
                  <li class="snap-start"
                    v-for="season in Object.keys(animeMap[anime_id].season_with_episode_hits || {})">
                    <button @click="toggleSeasonSelection(season)"
                      :class="{ 'bg-sgrayhover': isSelectedSeason(season) }"
                      class="flex border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                      <span :class="{ '': isSelectedSeason(season) }" class="">Temporada {{ season }}</span>
                      <span class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">
                        {{ Object.values(animeMap[anime_id]?.season_with_episode_hits[season]).reduce((total,
                          valorActual) => total + valorActual, 0) }}
                      </span>
                    </button>
                  </li>
                </div>
                <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600"></div>
              </ul>
            </div>
            <div v-if="animeMap[anime_id] && anime_id !== 0 && selected_season && filtersVisible">
              <ul
                class="z-20 divide-y  divide-gray-600 text-sm xxl:text-base xxm:text-2xl font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-sgray dark:border-gray-600 dark:text-white">
                <div
                  class="flex items-center w-full px-4 py-2 text-center justify-center rounded-t-lg rounded-l-lg dark:border-gray-600">
                  <span class="font-medium text-base">Episodios</span>
                </div>
                <div class="overflow-auto snap-y max-h-[26vh]">
                  <button @click="toggleEpisodeSelection('all')"
                    :class="{ 'bg-sgrayhover': selectedEpisodes.length === 0 }"
                    class="flex border duration-300 items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                    <span>{{ t('searchpage.main.labels.all') }}</span>
                  </button>
                  <li class="snap-start-disabled"
                    v-for="episode in Object.keys(animeMap[anime_id]?.season_with_episode_hits[selected_season])">
                    <button @click="toggleEpisodeSelection(episode)" :class="{ 'bg-sgrayhover': isSelected(episode) }"
                      class="flex border duration-300  hover:bg-sgrayhover items-center justify-between w-full px-4 py-2 text-sm xxl:text-base xxm:text-2xl text-left dark:border-white/5">
                      <span :class="{ '': isSelected(episode) }">Episodio {{ episode }}</span>
                      <span class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">
                        {{ animeMap[anime_id]?.season_with_episode_hits[selected_season][episode] }}
                      </span>
                    </button>
                  </li>
                </div>
                <div class="flex items-center justify-between w-full px-4 py-3.5 text-left dark:border-gray-600"></div>
              </ul>
            </div>
          </div>

        </div>
      </div>
      <div class="lg:ml-20 lg:w-[400px]"
        v-else-if="sentences.length === 0 && querySearch !== '' && isLoading === true && error_connection === false">
        <div role="status" class="hidden w-11/12 lg:flex flex-col py-6 animate-pulse">
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[460px] mb-4"></div>
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[460px] mb-2.5"></div>
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[300px] mb-2.5"></div>
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[330px] mb-2.5"></div>
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[300px] mb-2.5"></div>
          <div class="h-2 bg-gray-200 rounded-full dark:bg-graypalid max-w-[300px] mb-2.5"></div>

          <span class="sr-only">Cargando...</span>
        </div>
      </div>
    </div>
  </div>
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

* {
  scrollbar-width: thin;
  scrollbar-color: var(--secondary) var(--primary);
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

em {
  text-decoration: underline;
  text-underline-offset: 0.2em;
  font-style: normal;
  color: rgb(251, 120, 120);
}


#tab-headers ul {
  margin: 0;
  padding: 0;
  display: flex;
  border-bottom: 3px solid #dddddd21;
}

#tab-headers ul li {
  list-style: none;
  padding: 1rem 1.25rem;
  position: relative;
  cursor: pointer;
}

#tab-headers ul li.active {
  color: rgb(251, 120, 120);
  font-weight: bold;
}

#tab-headers ul li.active:after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  height: 2px;
  width: 100%;
  background: rgb(251, 120, 120);
}

#active-tab,
#tab-headers {
  width: 100%;
}

#active-tab {
  padding: 0.75rem;
}
</style>
