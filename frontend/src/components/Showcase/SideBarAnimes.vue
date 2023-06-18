<script setup>
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
      <input
        type="search"
        id="default-search"
        autocomplete="off"
        class="block w-full p-4 pl-4 text-sm text-gray-900 border-1 border-gray-300 rounded-lg focus:border-red-500 dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
        placeholder="Anime, drama, serie..."
        required
      />

      <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
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
        <li v-for="item in list">
          <button
            @click="filterAnime(item.anime_id)"
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
