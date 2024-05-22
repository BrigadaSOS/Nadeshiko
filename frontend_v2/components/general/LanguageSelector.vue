<script setup>
import { mdiTranslate } from '@mdi/js'

</script>
<template>
    <div class="hs-dropdown [--placement:top-left] relative inline-flex">
        <button id="footer-language-dropdown" type="button"
            class="hs-dropdown-toggle py-2 px-4 inline-flex items-center gap-x-2 text-sm sm:text-sm font-semibold rounded-lg  border hover:bg-button-primary-hover  text-gray-800   disabled:opacity-50 disabled:pointer-events-none  dark:text-white ">
            <UiBaseIcon :path="mdiTranslate" w="w-10 md:w-5" h="h-10 md:h-5" size="24" class="md:mr-2" />
            English
            <svg class="hs-dropdown-open:rotate-180 flex-shrink-0 size-4 text-white"
                xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m18 15-6-6-6 6" />
            </svg>
        </button>

        <div class="hs-dropdown-menu w-40 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden z-10 bg-white shadow-md rounded-lg dark:bg-neutral-800  dark:border-neutral-700 dark:divide-neutral-700"
            aria-labelledby="footer-language-dropdown">
            <a class="flex items-center gap-x-2 py-2 px-3 rounded-lg text-sm text-gray-800 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                href="#">
                English
            </a>
            <a class="flex items-center gap-x-2 py-2 px-3 rounded-lg text-sm text-gray-800 hover:bg-gray-100 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                href="#">
                Spanish
            </a>
        </div>
    </div>
</template>