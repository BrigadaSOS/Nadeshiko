<script setup lang="ts">
const { t } = useI18n();
const { showEnglish, showSpanish, setShowEnglish, setShowSpanish } = useTranslationVisibility();

const liveMessage = ref('');

const toggleEnglish = async () => {
  const next = !showEnglish.value;
  await setShowEnglish(next);
  liveMessage.value = next
    ? t('searchpage.main.translationPreferences.englishShown')
    : t('searchpage.main.translationPreferences.englishHidden');
};

const toggleSpanish = async () => {
  const next = !showSpanish.value;
  await setShowSpanish(next);
  liveMessage.value = next
    ? t('searchpage.main.translationPreferences.spanishShown')
    : t('searchpage.main.translationPreferences.spanishHidden');
};
</script>

<template>
  <div class="flex items-center gap-3">
    <button
      type="button"
      :aria-pressed="showEnglish"
      :title="showEnglish ? t('searchpage.main.translationPreferences.englishShown') : t('searchpage.main.translationPreferences.englishHidden')"
      class="rounded-md px-3 py-1 text-sm font-medium border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :class="showEnglish
        ? 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30'
        : 'bg-neutral-800 text-neutral-500 border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50'"
      @click="toggleEnglish"
    >
      EN
    </button>

    <button
      type="button"
      :aria-pressed="showSpanish"
      :title="showSpanish ? t('searchpage.main.translationPreferences.spanishShown') : t('searchpage.main.translationPreferences.spanishHidden')"
      class="rounded-md px-3 py-1 text-sm font-medium border active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :class="showSpanish
        ? 'bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30'
        : 'bg-neutral-800 text-neutral-500 border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50'"
      @click="toggleSpanish"
    >
      ES
    </button>

    <p aria-live="polite" class="sr-only">
      {{ liveMessage }}
    </p>
  </div>
</template>
