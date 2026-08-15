<script setup lang="ts">
import { mdiTranslate } from '@mdi/js';

import { useI18n } from 'vue-i18n';
import { useLocalePreference } from '~/composables/useLocalePreference';

const props = withDefaults(
  defineProps<{
    testId?: string;
    dropUp?: boolean;
  }>(),
  {
    testId: 'language-selector',
    dropUp: false,
  },
);

const { locale, locales, setLocale } = useI18n();
// NOT `useSwitchLocalePath()`: on a search page the module builds these hrefs one
// percent-encoding layer deeper than the URL that was requested, which is how a
// single search URL bred an unbounded family of ever-longer ones. See
// `useLocaleSwitchPath`.
const switchLocalePath = useLocaleSwitchPath();
const { setPreferredLocale } = useLocalePreference();

type LocaleCode = Parameters<typeof setLocale>[0];

function getLocaleName(code: LocaleCode) {
  const locale = locales.value.find((i) => i.code === code);
  return locale ? locale.name : code;
}

const availableLocales = computed(() => {
  return locales.value;
});

async function switchLanguage(localeCode: LocaleCode) {
  setPreferredLocale(localeCode);
  await setLocale(localeCode);
}

const dropdownContainerClass = computed(() => {
  const position = props.dropUp ? 'bottom-full mb-1' : 'top-full mt-1';
  return `absolute ${position} right-0 z-50 min-w-60`;
});
</script>
<template>
  <SearchDropdownContainer :data-testid="props.testId" dropdownId="nd-dropdown-language"
    :dropdownContainerClass="dropdownContainerClass">
    <template #default>
      <SearchDropdownMainButton
        dropdownButtonClass="py-2 px-4 w-full inline-flex items-center gap-x-2 text-xs sm:text-xs font-semibold rounded-lg  border hover:bg-black/5 hover:border-white/70 transition-all disabled:opacity-50 disabled:pointer-events-none text-white"
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
