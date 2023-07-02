<script setup>
import { mdiTranslate } from "@mdi/js";
import { ref, reactive, computed, watch } from "vue";
import BaseIcon from "./minimal/BaseIcon.vue";
import { useI18n } from "vue-i18n";
const { t } = useI18n();
const i18nLocale = useI18n();

let translate = computed(() => {
  return {
    es: t("navbar.languages.spanish"),
    en: t("navbar.languages.english"),
  };
});

const data = reactive({
  isOptionsExpanded: false,
  selectedOption: translate.value[i18nLocale.locale.value],
});

const setOption = (option) => {
  data.selectedOption = translate.value[option];
  data.isOptionsExpanded = false;
  localStorage.setItem("language", option);
  window.location.reload();
};
</script>


<template>
  <nav class="bg-white border-gray-200 dark:bg-sred">
    <div class="flex flex-wrap lg:w-11/12 items-center justify-between mx-auto p-3 navbar">
      <a href="https://db.brigadasos.xyz/" class="flex items-center">
        <img src="../assets/logo.webp" class="h-8 mr-3 rounded-full" alt="Flowbite Logo" />
        <span class="self-center text-sm sm:text-base font-semibold whitespace-nowrap dark:text-white"
          >Brigada SOS</span
        >
      </a>
      <div class="flex md:order-2">
        
 

        <button id="" type="button" class="hidden md:inline border-transparent mx-4">
          <a href="https://discord.gg/ajWm26ADEj">
            <svg class="flex-none fill-white" width="24" height="24" viewBox="0 -10 70 70">
              <path
                fill-rule="evenodd"
                xmlns="http://www.w3.org/2000/svg"
                d="M60.105 4.898A58.55 58.55 0 0 0 45.653.415a.22.22 0 0 0-.233.11 40.784 40.784 0 0 0-1.8 3.697c-5.456-.817-10.886-.817-16.23 0-.485-1.164-1.201-2.587-1.828-3.697a.228.228 0 0 0-.233-.11 58.386 58.386 0 0 0-14.451 4.483.207.207 0 0 0-.095.082C1.578 18.73-.944 32.144.293 45.39a.244.244 0 0 0 .093.167c6.073 4.46 11.955 7.167 17.729 8.962a.23.23 0 0 0 .249-.082 42.08 42.08 0 0 0 3.627-5.9.225.225 0 0 0-.123-.312 38.772 38.772 0 0 1-5.539-2.64.228.228 0 0 1-.022-.378c.372-.279.744-.569 1.1-.862a.22.22 0 0 1 .23-.03c11.619 5.304 24.198 5.304 35.68 0a.219.219 0 0 1 .233.027c.356.293.728.586 1.103.865a.228.228 0 0 1-.02.378 36.384 36.384 0 0 1-5.54 2.637.227.227 0 0 0-.121.315 47.249 47.249 0 0 0 3.624 5.897.225.225 0 0 0 .249.084c5.801-1.794 11.684-4.502 17.757-8.961a.228.228 0 0 0 .092-.164c1.48-15.315-2.48-28.618-10.497-40.412a.18.18 0 0 0-.093-.084Zm-36.38 32.427c-3.497 0-6.38-3.211-6.38-7.156 0-3.944 2.827-7.156 6.38-7.156 3.583 0 6.438 3.24 6.382 7.156 0 3.945-2.827 7.156-6.381 7.156Zm23.593 0c-3.498 0-6.38-3.211-6.38-7.156 0-3.944 2.826-7.156 6.38-7.156 3.582 0 6.437 3.24 6.38 7.156 0 3.945-2.798 7.156-6.38 7.156Z"
              />
            </svg>
          </a>
        </button>
        <div class="relative sm:block text-base  z-50 mx-3">
    <button
      class="flex items-center justify-between px-3 py-2 bg-sgray w-full border border-gray-500 rounded-lg mr-2"
      @click="data.isOptionsExpanded = !data.isOptionsExpanded"
      @blur="data.isOptionsExpanded = false"
    >
      <BaseIcon
        :path="mdiTranslate"
        w="w-10 md:w-5"
        h="h-10 md:h-5"
        size="24"
        class="md:mr-2"
      />
      <span class="">{{ data.selectedOption }}</span>
      <svg
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        class="h-4 w-4 transform transition-transform duration-200 ease-in-out"
        :class="data.isOptionsExpanded ? 'rotate-180' : 'rotate-0'"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>
    <transition
      enter-active-class="transform transition duration-500 ease-custom"
      enter-class="-translate-y-1/2 scale-y-0 opacity-0"
      enter-to-class="translate-y-0 scale-y-100 opacity-100"
      leave-active-class="transform transition duration-300 ease-custom"
      leave-class="translate-y-0 scale-y-100 opacity-100"
      leave-to-class="-translate-y-1/2 scale-y-0 opacity-0"
    >
      <ul
        v-show="data.isOptionsExpanded"
        class="absolute left-0  right-0  mb-4 mt-1 text-xl font-semibold bg-sgray divide-y rounded-lg shadow-lg overflow-hidden"
      >
        <li
          v-for="locale in $i18n.availableLocales"
          :value="locale"
          :key="locale"
          class="text-center my-2 cursor-pointer"
          @mousedown.prevent="setOption(locale)"
        >
          {{ translate[locale] }}
        </li>
      </ul>
    </transition>
  </div>
        <a
          href="https://brigadasos.xyz/"
          class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm px-4 py-2 text-center mr-1 md:mr-0 dark:bg-sgray dark:hover:bg-sgrayhover dark:focus:ring-blue-800"
        >
         {{t("navbar.buttons.guide")}}
        </a>
        
        <a
          data-collapse-toggle="navbar-cta"
          class="inline-flex items-center p-2 text-sm text-gray-500 rounded-lg md:hidden hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-200 dark:text-white dark:hover:bg-gray-700 dark:focus:ring-gray-600"
          aria-controls="navbar-cta"
          aria-expanded="false"
        >
          <span class="sr-only">Open main menu</span>
          <svg
            class="w-6 h-6"
            aria-hidden="true"
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fill-rule="evenodd"
              d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
              clip-rule="evenodd"
            ></path>
          </svg>
        </a>
      </div>

      <div class="items-center justify-between hidden w-full md:flex md:w-auto md:order-1" id="navbar-cta">
        <ul
          class="flex sm:hidden flex-col font-medium p-4 md:p-0 mt-4 border border-gray-100 rounded-lg bg-gray-50 md:flex-row md:space-x-8 md:mt-0 md:border-0 md:bg-white dark:bg-sgray md:dark:bg-sgray dark:border-gray-700"
        >
          <li>
            <a
              href="https://discord.gg/ajWm26ADEj"
              class="block py-2 pl-3 pr-4 text-white bg-sred rounded md:bg-transparent md:text-blue-700 md:p-0 md:dark:text-blue-500"
              aria-current="page"
              >Discord</a
            >
          </li>
        </ul>
      </div>
    </div>
  </nav>
</template>

<style>
.navbar {
  height: var(3.75rem);
  padding: var(calc(var(--ifm-spacing-vertical) * 0.5)) var(1rem);
}
</style>
