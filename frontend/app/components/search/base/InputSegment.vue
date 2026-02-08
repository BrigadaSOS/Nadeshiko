<script setup>
import { mdiTextSearch } from '@mdi/js';

const route = useRoute();
const query = ref('');

const headers = useRequestHeaders(['user-agent']);
const isMobile = computed(() => {
  const ua = process.client ? navigator.userAgent : headers['user-agent'] || '';
  return /Android|webOS|iPhone|iPad|Opera Mini/i.test(ua);
});

const navigateSearchSentence = async () => {
  const { query: _query, ...restOfQuery } = route.query;
  await navigateTo({
    path: '/search/sentence',
    query: {
      ...restOfQuery,
      ...(query.value && { query: query.value }),
    },
  });
};

const handleKeyDown = (event) => {
  if (event.shiftKey && event.key === 'S') {
    const inputElem = document.getElementById('sentence-search-input');
    const rect = inputElem.getBoundingClientRect();

    // The element is no longer visible
    if (rect.bottom <= 0) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: 'instant' });
      inputElem.focus();
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  query.value = route.query.query;
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>
<template>
  <SearchModalBatch />

  <!-- Form -->
  <div @submit.prevent="navigateSearchSentence">
    <div class="relative mt-2 flex space-x-3 py-2 rounded-lg shadow-gray-100  dark:border-neutral-500">
      <div class="flex-[1_0_0%] ">
        <label for="sentence-search-input" class="block text-sm text-gray-700 font-medium dark:text-white"><span
            class="sr-only">Search anything!</span></label>
        <input id="sentence-search-input" :autofocus="!isMobile" v-model="query" @keydown.enter="navigateSearchSentence"
          class=" dark:focus:ring-gray-500 border py-3 dark:focus:border-gray-500 h-full px-4 block w-full border-transparent rounded-lg  focus:outline-none dark:bg-input-background dark:border-neutral-600 dark:text-white/80 dark:placeholder-neutral-500"
          placeholder="Search anything!" />
        <div class="absolute inset-y-0 end-0 flex items-center pointer-events-none  pe-36">
          <span
            class=" flex-wrap items-center hidden md:flex py-3 text-center gap-x-1 text-base text-gray-400 dark:text-white">
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 bg-white border border-gray-200 font-mono text-sm text-gray-800 rounded-md dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200">
              <svg class="flex-shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                stroke-linejoin="round">
                <path d="M9 18v-6H5l7-7 7 7h-4v6H9z"></path>
              </svg>
            </kbd>
            +
            <kbd
              class="min-h-[30px] min-w-[30px] inline-flex justify-center items-center py-1 px-1.5 bg-white border border-gray-200 font-mono text-sm text-gray-800 rounded-md dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200">
              S
            </kbd>
          </span>
          <!-- End KBD -->
        </div>

      </div>
      <div class="flex gap-2">
        <button
          class="py-4 px-4 dark:border-neutral-700 border inline-flex justify-center items-center text-sm font-semibold rounded-lg  bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          data-nd-overlay="#nd-vertically-centered-scrollable-batch">
          <UiBaseIcon :path="mdiTextSearch" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
        </button>

        <button
          class="py-4 px-4 dark:border-neutral-700 border inline-flex justify-center items-center text-sm font-semibold rounded-lg  bg-button-primary-main text-white hover:bg-button-primary-hover disabled:opacity-50 disabled:pointer-events-none"
          @click="navigateSearchSentence">
          <svg class="flex-shrink-0 size-5" xmlns="http://www.w3.org/2000/svg" width="24" height="24"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </div>
    </div>
  </div>
  <!-- End Form -->
</template>
