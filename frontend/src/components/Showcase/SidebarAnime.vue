<script setup>
import { ref, computed } from 'vue'
const props = defineProps({
  list: {
    type: Object,
    default: null
  },
  sentences: {
    type: Object,
    default: null
  }
})

let querySearchAnime = ref('')


const filteredAnimes = computed(() => {
  const filteredItems = props.list.filter(item => {
    return item.name_anime_en.toLowerCase().includes(querySearchAnime.value.toLowerCase());
  });

  const sortedItems = filteredItems.sort((a, b) => {
    const nameA = a.name_anime_en.toLowerCase();
    const nameB = b.name_anime_en.toLowerCase();
    if (nameA === "todo") return -1;
    if (nameB === "todo") return 1;
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  return sortedItems;
});


const emits = defineEmits(['filter-anime'])

const fired = (id) => {
  emits('filter-anime', id)
}
</script>

<template>
  <!-- drawer init and show -->
  <div class="fixed right-6 bottom-6 z-30 group lg:hidden">
    <button
      type="button"
      id="drawer-button"
      data-drawer-target="drawer-navigation"
      data-drawer-show="drawer-navigation"
      aria-controls="drawer-navigation"
      class="flex items-center justify-center outline-none text-white bg-sgray rounded-full w-14 h-14 hover:bg-sgrayhover dark:bg-sred focus:ring-4 focus:outline-none"
    >
      <svg
        aria-hidden="true"
        class="w-8 h-8 transition-transform"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          xmlns="http://www.w3.org/2000/svg"
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          fill="#ffffff"
        />
      </svg>
      <span class="sr-only">Open actions menu</span>
    </button>
  </div>

  <!-- drawer component -->
  <div
    id="drawer-navigation"
    class="fixed lg:hidden bg-opacity-900 top-0 z-40 left-0 w-64 h-screen p-4 overflow-y-auto transition-transform -translate-x-full bg-white dark:bg-sgray2"
    tabindex="-1"
    aria-labelledby="drawer-navigation-label"
  >
    <h5 id="drawer-navigation-label" class="text-base font-semibold text-gray-500 uppercase dark:text-gray-400">
      Filtros
    </h5>

    <div class="relative lg:w-11/12 mx-auto mt-4">
      
      <div class="hs-dropdown relative inline-block w-full z-40">
            <button
              id="hs-dropdown-default"
              type="button"
              class="hs-dropdown-toggle py-3 px-4 w-full mb-4 inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
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
              Sortear oraciones
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
              class="hs-dropdown-menu transition-[opacity,margin] duration-[0.1ms] hs-dropdown-open:opacity-100 opacity-0 w-2/12 hidden z-10 mt-2 min-w-[15rem] bg-white shadow-md rounded-lg p-2 dark:bg-sgray dark:border dark:border-gray-700 dark:divide-gray-700"
              aria-labelledby="hs-dropdown-default"
            >
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
                Más cortas
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
                Más largas
              </a>
            </div>
          </div>

      <div class="flex flex-inline">
      <input
        type="search"
        v-model="querySearchAnime"
        id="default-search2"
        autocomplete="off"
        class="block w-full p-4 pl-4 text-sm text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
        placeholder="Buscador..."
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
    </div>
    <button
      type="button"
      data-drawer-hide="drawer-navigation"
      aria-controls="drawer-navigation"
      class="text-gray-400 bg-transparent hover:bg-gray-200 hover:text-gray-900 rounded-lg text-sm p-1.5 absolute top-2.5 right-2.5 inline-flex items-center dark:hover:bg-gray-600 dark:hover:text-white"
    >
      <svg
        aria-hidden="true"
        class="w-5 h-5"
        fill="currentColor"
        viewBox="0 0 20 20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fill-rule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clip-rule="evenodd"
        ></path>
      </svg>
      <span class="sr-only">Close menu</span>
    </button>

    <div v-if="sentences.length > 0" class="lg:flex flex-col overflow-y-auto py-6">
      <ul
        id="unique-animes"
        class="sticky z-30 divide-y divide-gray-600 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg dark:bg-sgray dark:border-gray-600 dark:text-white"
      >
        <li v-for="item in filteredAnimes">
          <button
            @click="fired(item.anime_id)"
            class="flex items-center justify-between w-full px-4 py-2 hover:bg-sgrayhover text-left rounded-t-lg dark:border-gray-600"
          >
            <span>{{ item.name_anime_en }}</span>
            <span class="bg-gray-500 text-white rounded-full px-2 py-1 text-xs">{{ item.amount_sentences_found }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style>
:is(.dark .dark\:bg-opacity-80) {
  --tw-bg-opacity: 0.6;
  background-color: #181717a8;
}
input[type='search']::-webkit-search-decoration,
input[type='search']::-webkit-search-cancel-button,
input[type='search']::-webkit-search-results-button,
input[type='search']::-webkit-search-results-decoration {
  -webkit-appearance: none;
}
</style>
