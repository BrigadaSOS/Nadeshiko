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
    <button type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="hs-offcanvas-right" data-hs-overlay="#hs-offcanvas-right"
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
  <div id="hs-offcanvas-right" class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hs-overlay-open:translate-x-0 hidden translate-x-full fixed top-0 end-0 transition-all duration-300 transform h-full max-w-xs w-full z-[80] bg-white border-s dark:bg-neutral-800 dark:border-neutral-700" role="dialog" tabindex="-1" aria-labelledby="hs-offcanvas-right-label">
  <div class="flex justify-between items-center py-3 px-4 border-b dark:border-neutral-700">
    <h3 id="hs-offcanvas-right-label" class="font-bold text-gray-800 dark:text-white">
      Filtros
    </h3>
    <button type="button" class="size-8 inline-flex justify-center items-center gap-x-2 rounded-full border border-transparent bg-gray-100 text-gray-800 hover:bg-gray-200 focus:outline-none focus:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:text-neutral-400 dark:focus:bg-neutral-600" aria-label="Close" data-hs-overlay="#hs-offcanvas-right">
      <span class="sr-only">Close</span>
      <svg class="shrink-0 size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    </button>
  </div>
  <div class="p-4">
    <div v-if="searchData?.sentences?.length > 0" class=" mx-auto px-4 ">
        <SearchSegmentFilterSortContent />
        <SearchSegmentFilterContent :searchData="searchData" :categorySelected="categorySelected" />
      </div>
      <div v-else>
        <div class="mx-auto hidden lg:block max-w-xs">
          <div role="status" class="hidden lg:flex flex-col py-6 animate-pulse">
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[460px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[330px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <div class="h-2 bg-gray-200 rounded-full dark:bg-neutral-700 max-w-[300px] mb-2.5"></div>
            <span class="sr-only">Cargando...</span>
          </div>
        </div>
      </div>
  </div>
</div>

  <!-- End Sidebar -->

</template>
