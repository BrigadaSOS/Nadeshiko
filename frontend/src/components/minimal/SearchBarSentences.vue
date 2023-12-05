<script setup>
import router from '../../router/index'
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { mdiTuneVariant } from '@mdi/js'
import BaseIcon from '../minimal/BaseIcon.vue'
import SettingsSearchModal from '../Showcase/SettingsSearchModal.vue'

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
import { userStore } from '../../stores/user'

const props = defineProps({
  isLoading: {
    type: Boolean,
    default: false
  },
  error_connection: {
    type: Boolean,
    default: false
  },
  path: {
    type: String,
    default: null
  }
})

const { t, locale } = useI18n()
const store = userStore()

// Variables
let querySearch = ref('')
let type_sort = ref(null)
const exactMatchFromStore = computed(() => store.$state.filterPreferences.exact_match)
let isModalSettingsSearchActive = ref(false)

const searchBar = ref(null)
const searchBarHeight = ref(0)
const emits = defineEmits(['searchBarHeight'])

// Lógica de la barra de búsqueda
const searchHandler = async (event) => {
  event.preventDefault()
  const searchTerm = querySearch.value.trim()
  const sortTerm = type_sort.value ? type_sort.value.trim() : null
  const exact_match = exactMatchFromStore.value !== null ? exactMatchFromStore.value : exact_match === 'true'

  if (searchTerm !== '') {
    const query = {
      query: querySearch.value
    }

    if (sortTerm) {
      query.sort = sortTerm
    }

    if (exact_match === true) {
      query.exact_match = exact_match
    }

    if (props.path) {
      await router.push({ path: props.path, query: query })
    } else {
      await router.push({ query: query })
    }
  }
}

onMounted(async () => {
  const urlParams = new URLSearchParams(window.location.search)
  querySearch.value = urlParams.get('query')

  /* When the user scrolls down, hide the navbar. When the user scrolls up, show the navbar */
  await nextTick()

  searchBarHeight.value = searchBar?.value.offsetHeight + 20
  let prevScrollpos = window.scrollY
  window.onscroll = function () {
    var currentScrollPos = window.scrollY
    if (prevScrollpos > currentScrollPos) {
      try {
        document.getElementById('search-bar').style.top = '0'
        searchBarHeight.value = searchBar?.value.offsetHeight
      } catch (error) {}
    } else {
      try {
        document.getElementById('search-bar').style.top = '-50px'
        searchBarHeight.value = searchBar?.value.offsetHeight - 45
      } catch (error) {}
    }
    prevScrollpos = currentScrollPos
    emits('searchBarHeight', searchBarHeight.value)
  }
})

// Invoca el modal de la configuración de la barra de busqueda
const showModalSettingsSearch = async () => {
  isModalSettingsSearchActive.value = true
}


watch(exactMatchFromStore, async (newValue, oldValue) => {
  if (newValue !== oldValue) {
    try {
      console.log(newValue)
      searchHandler(event)
    } catch (error) {
      console.log(error)
    }
  }
})


watch(
  () => window.innerHeight,
  () => {
    searchBarHeight.value = searchBar.value.offsetHeight
  }
)
// VARIABLES con traducciones en lugares imposibles de forma directa
let placeholder_search1 = t('searchpage.main.labels.searchmain')
</script>
<template>
  <div class="sticky z-30 top-0" id="search-bar" ref="searchBar">
    <form @submit="searchHandler">
      <label
        for="default-search"
        class="mb-2 text-sm xxl:text-base xxm:text-2xl font-medium z-30 text-gray-900 sr-only dark:text-white"
        >{{ t('searchpage.main.buttons.search') }}</label
      >
      <div class="relative lg:w-11/12 mx-auto mt-4">
        <div class="flex">
          <div class="absolute inset-y-0 left-0 flex items-center justify-center pl-3 pointer-events-none">
            <div
              v-if="
                (!props.isLoading && props.error_connection === true) ||
                props.error_connection === true ||
                (!props.isLoading && props.error_connection === false)
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
            <div v-else-if="props.isLoading && props.error_connection === false">
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
              :placeholder="placeholder_search1"
              required
              @keydown.enter="searchHandler"
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
  <SettingsSearchModal v-if="isModalSettingsSearchActive" />
</template>
