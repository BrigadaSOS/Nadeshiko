<script setup lang="ts">
const shortcutsModal = ref<{ open: () => void } | null>(null);
const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-3">
    <SearchModalKeyboardShortcuts ref="shortcutsModal" />
    <SearchTranslationVisibilityPreferences />
    <button
      class="nd-btn hidden lg:inline-flex"
      :title="t('shortcuts.title')"
      @click="shortcutsModal?.open()"
    >
      {{ t('shortcuts.title') }}
    </button>
  </div>
</template>
