<script setup lang="ts">
import { mdiCheck, mdiEye, mdiEyeClosed, mdiEyeOff } from '@mdi/js';
import type { TranslationVisibilityMode } from '~/composables/useTranslationVisibility';

const props = defineProps<{
  label: string;
  mode: TranslationVisibilityMode;
  menuTitle: string;
  title: string;
  testId: string;
  showLanguageSettingsHint?: boolean;
}>();

const emit = defineEmits<{
  select: [mode: TranslationVisibilityMode];
}>();

const { t } = useI18n();
const localePath = useLocalePath();

const MODE_ITEMS: ReadonlyArray<{
  id: TranslationVisibilityMode;
  icon: string;
  labelKey: 'modeShown' | 'modeSpoiler' | 'modeHidden';
}> = [
  { id: 'show', icon: mdiEye, labelKey: 'modeShown' },
  { id: 'spoiler', icon: mdiEyeClosed, labelKey: 'modeSpoiler' },
  { id: 'hidden', icon: mdiEyeOff, labelKey: 'modeHidden' },
];

const currentIcon = computed(() => MODE_ITEMS.find((item) => item.id === props.mode)?.icon ?? mdiEye);
</script>

<template>
  <SearchDropdownContainer
    :dropdown-id="`nd-visibility-${testId}`"
    teleport
    teleport-align="end"
    dropdown-container-class="z-[60] min-w-44 max-w-[calc(100vw-2rem)]"
  >
    <template #default="{ toggle, isOpen }">
      <button
        type="button"
        :data-testid="testId"
        :title="title"
        :aria-label="title"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        class="nd-btn"
        @click="toggle"
      >
        <UiBaseIcon :path="currentIcon" w="w-3.5" h="h-3.5" size="14" aria-hidden="true" />
        <span>{{ label }}</span>
      </button>
    </template>

    <template #content>
      <p class="nd-menu-header">{{ menuTitle }}</p>
      <div role="menu" :aria-label="menuTitle">
        <button
          v-for="item in MODE_ITEMS"
          :key="item.id"
          type="button"
          role="menuitemradio"
          :aria-checked="mode === item.id"
          :data-testid="`${testId}-option-${item.id}`"
          class="nd-menu-item"
          :class="{ 'is-selected': mode === item.id }"
          @click="emit('select', item.id)"
        >
          <UiBaseIcon :path="item.icon" w="w-4" h="h-4" size="16" aria-hidden="true" />
          <span class="flex-1 text-left">{{ t(`searchpage.main.translationPreferences.${item.labelKey}`) }}</span>
          <UiBaseIcon
            v-if="mode === item.id"
            :path="mdiCheck"
            w="w-3.5"
            h="h-3.5"
            size="14"
            class="text-accent-soft"
            aria-hidden="true"
          />
        </button>
      </div>
      <template v-if="showLanguageSettingsHint">
        <div class="nd-menu-divider" />
        <NuxtLink :to="localePath('/user/settings')" class="nd-menu-item text-left text-xs text-gray-400">
          {{ t('searchpage.main.translationPreferences.languageSettingsHint') }}
        </NuxtLink>
      </template>
    </template>
  </SearchDropdownContainer>
</template>
