<script setup>
import ListAnime from './Showcase/ListAnime.vue'
import BaseIcon from './minimal/BaseIcon.vue';
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { userStore } from "../stores/user";
import {
  mdiTuneVariant
} from '@mdi/js'
import router from '../router/index'

const store = userStore();

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t } = useI18n()

const querySearch = ref('')
let type_sort = ref(null)
const exactMatchFromStore = computed(() => store.$state.filterPreferences.exact_match);

// VARIABLES con traducciones en lugares imposibles de forma directa
let placeholder_search1 = t('searchpage.main.labels.searchmain')
let placeholder_search2 = t('searchpage.main.labels.searchbar')

const searchHandler = async (event) => {
  event.preventDefault()
  const searchTerm = querySearch.value.trim()
  const sortTerm = (type_sort.value) ? type_sort.value.trim() : null
  const exact_match = exactMatchFromStore.value !== null ? exactMatchFromStore.value : (exact_match === 'true');
  
  if (searchTerm !== '') {
    const query = {
      query: querySearch.value
    }

    if(sortTerm) {
      query.sort = sortTerm
    }

    if (exact_match === true) {
      query.exact_match = exact_match;
    }

    await router.push({path: '/search/sentences', query: query});

  }
}
</script>

<template>
  <div class="w-screen">
    <div class="sticky z-30 top-0" id="search-bar" ref="searchBar">
    <form @submit="searchHandler">
      <label for="default-search" class="mb-2 text-sm font-medium z-30 text-gray-900 sr-only dark:text-white">{{
        t('searchpage.main.buttons.search')
      }}</label>
      <div class="relative lg:w-11/12 mx-auto mt-4">
        <div class="flex">
          <div class="absolute inset-y-0 left-0 flex items-center justify-center pl-3 pointer-events-none">
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
  <div class="flex flex-row  lg:w-11/12 mx-auto mb-20">
    <div class="container sm:max-w-screen-lg md:max-w-full mx-auto flex flex-col">
      <ListAnime />
    </div>
  </div>
</div>
</template>
