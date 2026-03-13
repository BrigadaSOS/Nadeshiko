<script setup lang="ts">
const { t } = useI18n();
const { englishMode, spanishMode, cycleEnglishMode, cycleSpanishMode } = useTranslationVisibility();
const { showHiragana, toggleHiragana } = useHiraganaVisibility();

type TranslationVisibilityMode = 'show' | 'spoiler' | 'hidden';

const liveMessage = ref('');

const modeButtonClass = (mode: TranslationVisibilityMode) => {
  if (mode === 'show') {
    return 'bg-neutral-800 text-neutral-500 border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50';
  }
  if (mode === 'spoiler') {
    return 'bg-amber-500/20 text-amber-200 border-amber-500/40 hover:bg-amber-500/30';
  }
  return 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30';
};

const modeTitle = (lang: 'english' | 'spanish', mode: TranslationVisibilityMode) => {
  if (mode === 'show') {
    return t(`searchpage.main.translationPreferences.${lang}Shown`);
  }
  if (mode === 'spoiler') {
    return t(`searchpage.main.translationPreferences.${lang}Spoiler`);
  }
  return t(`searchpage.main.translationPreferences.${lang}Hidden`);
};

const toggleEnglish = async () => {
  await cycleEnglishMode();
  liveMessage.value = modeTitle('english', englishMode.value);
};

const toggleSpanish = async () => {
  await cycleSpanishMode();
  liveMessage.value = modeTitle('spanish', spanishMode.value);
};
</script>

<template>
  <div class="flex items-center gap-3">
    <button
      type="button"
      :aria-pressed="englishMode !== 'hidden'"
      :title="modeTitle('english', englishMode)"
      class="rounded-md px-3 py-1 text-sm font-medium border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :class="modeButtonClass(englishMode)"
      @click="toggleEnglish"
    >
      EN
    </button>

    <button
      type="button"
      :aria-pressed="spanishMode !== 'hidden'"
      :title="modeTitle('spanish', spanishMode)"
      class="rounded-md px-3 py-1 text-sm font-medium border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :class="modeButtonClass(spanishMode)"
      @click="toggleSpanish"
    >
      ES
    </button>

    <button
      type="button"
      :aria-pressed="showHiragana"
      :title="showHiragana ? t('searchpage.main.translationPreferences.hiraganaShown') : t('searchpage.main.translationPreferences.hiraganaHidden')"
      class="rounded-md px-3 py-1 text-sm font-medium border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :class="showHiragana
        ? 'bg-neutral-800 text-neutral-500 border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50'
        : 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30'"
      @click="toggleHiragana"
    >
      ひ
    </button>

    <p aria-live="polite" class="sr-only">
      {{ liveMessage }}
    </p>
  </div>
</template>
