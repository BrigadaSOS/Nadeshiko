<script setup>
import { mdiTranslate } from '@mdi/js'
import { useI18n } from 'vue-i18n'

const i18nLocale = useI18n()


let translate = computed(() => {
    return {
        es: t('navbar.languages.spanish'),
        en: t('navbar.languages.english')
    }
})

//////////////////////

const setOption = (option) => {
  data.selectedOption = translate.value[option]
  data.isOptionsExpanded = false
  localStorage.setItem('language', option)
  window.location.reload()
}

const route = useRoute()
const {
  t,
  rt,
  tm,
  strategy,
  locale,
  locales,
  localeProperties,
  setLocale,
  defaultLocale,
  finalizePendingLocaleChange
} = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
const getRouteBaseName = useRouteBaseName()


function getLocaleName(code) {
  const locale = locales.value.find(i => i.code === code)
  return locale ? locale.name : code
}

const availableLocales = computed(() => {
  return locales.value
})

</script>
<template>
    <div class="hs-dropdown [--placement:top-left] relative inline-flex">
        <button id="footer-language-dropdown" type="button"
            class="hs-dropdown-toggle py-2 px-4 inline-flex items-center gap-x-2 text-sm sm:text-sm font-semibold rounded-lg  border hover:bg-button-primary-hover  text-gray-800   disabled:opacity-50 disabled:pointer-events-none  dark:text-white ">
            <UiBaseIcon :path="mdiTranslate" w="w-10 md:w-5" h="h-10 md:h-5" size="24" class="md:mr-2" />
            English
            <svg class="hs-dropdown-open:rotate-180 flex-shrink-0 size-4 text-white" xmlns="http://www.w3.org/2000/svg"
                width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="m18 15-6-6-6 6" />
            </svg>
        </button>

        <div class="hs-dropdown-menu w-40 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden z-50 bg-white shadow-md rounded-lg dark:bg-neutral-800  dark:border-neutral-700 dark:divide-neutral-700"
            aria-labelledby="footer-language-dropdown">

            <li
          v-for="locale in i18nLocale.availableLocales"
          :value="locale"
          :key="locale"
          class="text-center hover:bg-sgrayhover my-2 cursor-pointer"
          @mousedown.prevent="setOption(locale)"
        >
          {{ translate[locale] }}
        </li>

        </div>
    </div>

    <h2 class="bg-blue-500">Current Language: {{ getLocaleName(locale) }} </h2>
    <nav>
      <span v-for="locale in availableLocales" :key="locale.code">
        
        <button @click="setLocale(locale.code)">{{ locale.name }}</button> |
      </span>
    </nav>

</template>