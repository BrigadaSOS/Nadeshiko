<script setup lang="ts">
import { mdiMessageTextOutline } from '@mdi/js';
import { usePlayerStore } from '~/stores/player';

/**
 * The bottom-end column that every floating button lives in.
 *
 * Rendered once by the default layout. It owns the two things that used to be
 * decided separately by each button -- how far the column sits off the corner,
 * and how far it steps up when the player bar takes the bottom edge -- which is
 * why the feedback button and the search page's scroll-to-top button both
 * claimed the same corner and drew on top of each other.
 *
 * Page-level buttons mount into `#nd-fab-dock` and stack above the feedback
 * button. That order is deliberate: feedback is on every page, so keeping it at
 * the foot of the column means it does not hop around as contextual buttons
 * come and go beneath the reader's cursor.
 */

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
  <!-- The gutter keeps the column still while a modal's scroll lock removes the
       scrollbar underneath it. -->
  <div
    class="fixed end-[calc(1.5rem+var(--scrollbar-gutter))] z-50 flex flex-col items-center gap-3 transition-[bottom] duration-300 ease-in-out"
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
