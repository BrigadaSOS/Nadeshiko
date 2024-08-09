<script setup>
import { mdiTranslate } from '@mdi/js'
import { useI18n } from 'vue-i18n'

const {
  t,
  locale,
  locales,
  setLocale
} = useI18n()

function getLocaleName(code) {
  const locale = locales.value.find(i => i.code === code)
  return locale ? locale.name : code
}

const availableLocales = computed(() => {
  return locales.value
})

</script>
<template>
  <SearchDropdownContainer dropdownId="hs-dropdown-with-header">
    <template #default>
      <SearchDropdownMainButton
        dropdownButtonClass="py-2 px-4 inline-flex items-center gap-x-2 text-sm sm:text-sm font-semibold rounded-lg  border hover:bg-black/5 hover:border-white/70 transition-all  text-gray-800   disabled:opacity-50 disabled:pointer-events-none  dark:text-white"
        dropdownId="hs-dropdown-with-header">
        <UiBaseIcon :path="mdiTranslate" />
        {{ getLocaleName(locale) }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent>
        <SearchDropdownItem @click="setLocale(locale.code)" v-for="locale in availableLocales" :key="locale.code"
          :text="locale.name" />
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>
</template>