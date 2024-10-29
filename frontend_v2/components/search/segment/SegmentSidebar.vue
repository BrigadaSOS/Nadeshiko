<script setup>
import { mdiArrowUp } from '@mdi/js'
const showScrollButton = ref(false);

const props = defineProps(['searchData', 'categorySelected']);


const handleScroll = () => {
  showScrollButton.value = window.scrollY > 400;
};

const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: 'instant' });
};

onMounted(() => {
  window.addEventListener('scroll', handleScroll);
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
});

</script>
<template>

  <div class="fixed right-6 bottom-6 z-50 group">
    <Transition>
      <button type="button" v-if="showScrollButton" @click="scrollToTop"
        class="flex items-center justify-center outline-none mb-2  bg-sgray rounded-full w-14 h-14 hover:bg-sgrayhover dark:bg-header-background focus:ring-4 focus:outline-none">
        <UiBaseIcon :path="mdiArrowUp" w="5" h="5" size="20" fill="white" strokewidth="1" stroke="white" />
      </button>
    </Transition>
    <button type="button" data-hs-overlay="#docs-sidebar" aria-controls="docs-sidebar" aria-label="Toggle navigation"
      class="flex items-center justify-center outline-none 2xl:hidden text-white bg-sgray rounded-full w-14 h-14 hover:bg-sgrayhover dark:bg-header-background focus:ring-4 focus:outline-none">
      <svg aria-hidden="true" class="w-8 h-8 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg">
        <path xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd"
          d="M3 7C3 6.44772 3.44772 6 4 6H20C20.5523 6 21 6.44772 21 7C21 7.55228 20.5523 8 20 8H4C3.44772 8 3 7.55228 3 7ZM6 12C6 11.4477 6.44772 11 7 11H17C17.5523 11 18 11.4477 18 12C18 12.5523 17.5523 13 17 13H7C6.44772 13 6 12.5523 6 12ZM9 17C9 16.4477 9.44772 16 10 16H14C14.5523 16 15 16.4477 15 17C15 17.5523 14.5523 18 14 18H10C9.44772 18 9 17.5523 9 17Z"
          fill="#ffffff" />
      </svg>
      <span class="sr-only">Open actions menu</span>
    </button>
  </div>

  <!-- Sidebar -->
  <div id="docs-sidebar"
    class="hs-overlay [--auto-close:lg] hs-overlay-open:translate-x-0 -translate-x-full transition-all duration-300 transform hidden fixed top-0 start-0 bottom-0 z-[60] w-64 bg-white border-e border-gray-200 pt-7 pb-10 overflow-y-auto 2xl:hidden 2xl:translate-x-0 2xl:end-auto 2xl:bottom-0 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-track]:bg-neutral-700 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-500 dark:bg-neutral-800 dark:border-neutral-700">
    <div class="px-6">
      <a class="flex-none text-xl font-semibold dark:text-white" href="#" aria-label="Brand">Filtros</a>
    </div>
    <nav class="hs-accordion-group p-4 w-full flex flex-col flex-wrap" data-hs-accordion-always-open>

      <div v-if="searchData?.sentences?.length > 0" class=" mx-auto   ">
        <SearchSegmentFilterSortContent />
        <SearchSegmentFilterContent :searchData="searchData" :categorySelected="categorySelected" />
      </div>
      <div v-else>
        <div class="pl-4 mx-auto hidden lg:block min-w-[340px]">
          <div role=" status" class="hidden w-11/12 lg:flex flex-col py-6 animate-pulse">
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[460px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[330px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <span class="sr-only">Cargando...</span>
          </div>
        </div>

      </div>

    </nav>
  </div>

  <!-- End Sidebar -->

</template>
