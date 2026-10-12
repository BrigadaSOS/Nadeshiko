<script setup lang="ts">
import { mdiMessageTextOutline } from '@mdi/js';
import { usePlayerStore } from '~/stores/player';

/** One dock owns corner/player clearance. Page buttons teleport above feedback so its position stays stable. */

const { t } = useI18n();
const playerStore = usePlayerStore();
const { showPlayer, currentResult, isImmersive } = storeToRefs(playerStore);
const { isFeedbackOpen, openFeedback } = useFeedbackWidget();

/**
 * The player bar owns the bottom edge while something is playing, so the column
 * steps up over it instead of sitting underneath. Keyed on the result as well
 * as the flag: `showPlayer` can be set with nothing loaded, and there is no bar
 * to clear then.
 */
const isPlayerBarVisible = computed(() => showPlayer.value && !!currentResult.value && !isImmersive.value);
</script>

<template>
  <div
    class="fixed end-6 z-50 flex flex-col items-center gap-3 transition-[bottom] duration-300 ease-in-out"
    :class="isPlayerBarVisible ? 'bottom-40 md:bottom-24' : 'bottom-6'"
  >
    <!-- `contents` so an empty dock costs no height and no gap: a plain empty
         flex child would still push the feedback button up by one gap. -->
    <div id="nd-fab-dock" class="contents" />

    <!-- Hidden on phones: down there the corner belongs to the player bar and
         to the thumb. The navbar and footer entries open the same panel. -->
    <button
      v-if="!isImmersive"
      type="button"
      data-testid="feedback-fab"
      class="nd-fab hidden sm:flex"
      :aria-label="t('feedback.open')"
      :title="t('feedback.open')"
      aria-haspopup="dialog"
      :aria-expanded="isFeedbackOpen"
      @click="openFeedback()"
    >
      <UiBaseIcon :path="mdiMessageTextOutline" :size="24" />
    </button>
  </div>
</template>
