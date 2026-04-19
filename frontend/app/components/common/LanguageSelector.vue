<script setup>
import { mdiTranslate } from '@mdi/js';

import { useI18n } from 'vue-i18n';

const props = defineProps({
  testId: {
    type: String,
    default: 'language-selector',
  },
  dropUp: {
    type: Boolean,
    default: false,
  },
});

const { locale, locales, setLocale } = useI18n();
const switchLocalePath = useSwitchLocalePath();

function getLocaleName(code) {
  const locale = locales.value.find((i) => i.code === code);
  return locale ? locale.name : code;
}

const availableLocales = computed(() => {
  return locales.value;
});

async function switchLanguage(localeCode) {
  await setLocale(localeCode);
}

const dropdownContainerClass = computed(() => {
  const position = props.dropUp ? 'bottom-full mb-1' : 'top-full mt-1';
  return `nd-dropdown-menu absolute ${position} right-0 z-50 items-center text-center align-middle min-w-60 bg-white shadow-md p-2 dark:bg-neutral-800 border-none rounded-lg`;
});
</script>
<template>
  <SearchDropdownContainer :data-testid="props.testId" dropdownId="nd-dropdown-language"
    :dropdownContainerClass="dropdownContainerClass">
    <template #default>
      <SearchDropdownMainButton
        dropdownButtonClass="nd-dropdown-toggle py-2 px-4 w-full inline-flex items-center gap-x-2 text-xs sm:text-xs font-semibold rounded-lg  border hover:bg-black/5 hover:border-white/70 transition-all  text-gray-800   disabled:opacity-50 disabled:pointer-events-none  dark:text-white"
        dropdownId="nd-dropdown-language">
        <UiBaseIcon :path="mdiTranslate" />
        {{ getLocaleName(locale) }}
      </SearchDropdownMainButton>
    </template>
    <template #content>
      <SearchDropdownContent :header="$t('navbar.buttons.language')">
        <NuxtLink
          v-for="localeOption in availableLocales"
          :key="localeOption.code"
          :to="switchLocalePath(localeOption.code)"
          :prefetch="false"
          @click="switchLanguage(localeOption.code)"
        >
          <SearchDropdownItem :text="localeOption.name" />
        </NuxtLink>
      </SearchDropdownContent>
    </template>
  </SearchDropdownContainer>
</template>
