<script setup lang="ts">
const shortcutsModal = ref<{ open: () => void } | null>(null);
const { t } = useI18n();
</script>

<template>
  <div class="flex items-center gap-3">
    <SearchModalKeyboardShortcuts ref="shortcutsModal" />
    <SearchTranslationVisibilityPreferences />
    <button
      class="hidden lg:inline-flex rounded-md px-3 py-1 text-sm font-medium bg-neutral-800 text-neutral-500 border border-neutral-700/50 hover:text-neutral-300 hover:bg-neutral-700/50 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      :title="t('shortcuts.title')"
      @click="shortcutsModal?.open()"
    >
      {{ t('shortcuts.title') }}
    </button>
  </div>
</template>
