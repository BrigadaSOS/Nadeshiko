<script setup lang="ts">
import { mdiCheck, mdiEye, mdiEyeClosed, mdiEyeOff } from '@mdi/js';
import type { TranslationVisibilityMode } from '~/composables/useTranslationVisibility';

const { t } = useI18n();
const { englishMode, spanishMode, setEnglishMode, setSpanishMode } = useTranslationVisibility();
const { languages: translationLanguages } = useTranslationLanguages();
const { furiganaMode, setFuriganaMode } = useHiraganaVisibility();

const liveMessage = ref('');

const MODE_ITEMS: ReadonlyArray<{
  id: TranslationVisibilityMode;
  icon: string;
  labelKey: 'modeShown' | 'modeSpoiler' | 'modeHidden';
}> = [
  { id: 'show', icon: mdiEye, labelKey: 'modeShown' },
  { id: 'spoiler', icon: mdiEyeClosed, labelKey: 'modeSpoiler' },
  { id: 'hidden', icon: mdiEyeOff, labelKey: 'modeHidden' },
];

const modeTitle = (subject: 'english' | 'spanish' | 'furigana', mode: TranslationVisibilityMode) => {
  if (mode === 'show') {
    return t(`searchpage.main.translationPreferences.${subject}Shown`);
  }
  if (mode === 'spoiler') {
    return t(`searchpage.main.translationPreferences.${subject}Spoiler`);
  }
  return t(`searchpage.main.translationPreferences.${subject}Hidden`);
};

const languageModeTitle = (subject: 'english' | 'spanish', mode: TranslationVisibilityMode) =>
  `${modeTitle(subject, mode)} ${t('searchpage.main.translationPreferences.languageSettingsHint')}`;

const localePath = useLocalePath();

const selectEnglish = async (mode: TranslationVisibilityMode) => {
  await setEnglishMode(mode);
  liveMessage.value = modeTitle('english', englishMode.value);
};

const selectSpanish = async (mode: TranslationVisibilityMode) => {
  await setSpanishMode(mode);
  liveMessage.value = modeTitle('spanish', spanishMode.value);
};

const selectFurigana = (mode: TranslationVisibilityMode) => {
  setFuriganaMode(mode);
  liveMessage.value = modeTitle('furigana', furiganaMode.value);
};

const groups = computed(() =>
  [
    {
      key: 'en' as const,
      testId: 'visibility-en',
      title: t('searchpage.main.translationPreferences.englishMenu'),
      mode: englishMode.value,
      select: selectEnglish,
    },
    {
      key: 'es' as const,
      testId: 'visibility-es',
      title: t('searchpage.main.translationPreferences.spanishMenu'),
      mode: spanishMode.value,
      select: selectSpanish,
    },
    {
      key: 'furigana' as const,
      testId: 'visibility-furigana',
      title: t('searchpage.main.translationPreferences.furiganaMenu'),
      mode: furiganaMode.value,
      select: selectFurigana,
    },
  ].filter(
    (group) => group.key === 'furigana' || translationLanguages.value.includes(group.key.toUpperCase() as 'EN' | 'ES'),
  ),
);
</script>

<template>
  <div>
    <!-- One control on small screens: three chips in the tab row is what
         crushed the title tab, and a second row of the same chips just looked
         like leftover chrome. -->
    <SearchDropdownContainer
      class="md:hidden"
      dropdown-id="nd-visibility-combined"
      teleport
      teleport-align="end"
      dropdown-container-class="z-[60] w-[220px] min-w-56"
    >
      <template #default="{ toggle, isOpen }">
        <button
          type="button"
          data-testid="visibility-menu"
          :title="t('searchpage.main.translationPreferences.combinedMenuButton')"
          :aria-label="t('searchpage.main.translationPreferences.combinedMenuButton')"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          class="nd-btn size-8 p-0"
          @click="toggle"
        >
          <UiBaseIcon :path="mdiEye" w="w-4" h="h-4" size="16" aria-hidden="true" />
        </button>
      </template>

      <template #content>
        <div data-nd-keep-open>
          <div v-for="group in groups" :key="group.key" class="pb-1">
            <p class="nd-menu-header">{{ group.title }}</p>
            <div role="group" :aria-label="group.title">
              <button
                v-for="item in MODE_ITEMS"
                :key="item.id"
                type="button"
                role="menuitemradio"
                :aria-checked="group.mode === item.id"
                :data-testid="`${group.testId}-option-${item.id}`"
                class="nd-menu-item"
                :class="{ 'is-selected': group.mode === item.id }"
                @click="group.select(item.id)"
              >
                <UiBaseIcon :path="item.icon" w="w-4" h="h-4" size="16" aria-hidden="true" />
                <span class="flex-1 text-left">{{ t(`searchpage.main.translationPreferences.${item.labelKey}`) }}</span>
                <UiBaseIcon
                  v-if="group.mode === item.id"
                  :path="mdiCheck"
                  w="w-3.5"
                  h="h-3.5"
                  size="14"
                  class="text-accent-soft"
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          <div class="nd-menu-divider" />
          <NuxtLink :to="localePath('/user/settings')" class="nd-menu-item text-left text-xs text-gray-400">
            {{ $t('searchpage.main.translationPreferences.languageSettingsHint') }}
          </NuxtLink>
        </div>
      </template>
    </SearchDropdownContainer>

    <div class="hidden items-center gap-3 md:flex">
      <SearchVisibilityModeMenu
        v-if="translationLanguages.includes('EN')"
        label="EN"
        test-id="visibility-en"
        :mode="englishMode"
        :menu-title="t('searchpage.main.translationPreferences.englishMenu')"
        :title="languageModeTitle('english', englishMode)"
        show-language-settings-hint
        @select="selectEnglish"
      />

      <SearchVisibilityModeMenu
        v-if="translationLanguages.includes('ES')"
        label="ES"
        test-id="visibility-es"
        :mode="spanishMode"
        :menu-title="t('searchpage.main.translationPreferences.spanishMenu')"
        :title="languageModeTitle('spanish', spanishMode)"
        show-language-settings-hint
        @select="selectSpanish"
      />

      <SearchVisibilityModeMenu
        label="ふ"
        test-id="visibility-furigana"
        :mode="furiganaMode"
        :menu-title="t('searchpage.main.translationPreferences.furiganaMenu')"
        :title="modeTitle('furigana', furiganaMode)"
        @select="selectFurigana"
      />
    </div>

    <p aria-live="polite" class="sr-only">
      {{ liveMessage }}
    </p>
  </div>
</template>
