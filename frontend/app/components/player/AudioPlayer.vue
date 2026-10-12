<script setup lang="ts">
import {
  mdiRewind,
  mdiSkipPrevious,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiFastForward,
  mdiAnimationPlay,
  mdiMotionPauseOutline,
  mdiRepeat,
  mdiFullscreenExit,
  mdiClose,
  mdiFullscreen,
  mdiVolumeHigh,
  mdiVolumeMedium,
  mdiVolumeLow,
  mdiVolumeOff,
} from '@mdi/js';
import { PLAYBACK_RATES, resolveClipWindow, usePlayerStore } from '~/stores/player';
import { splitLocalePrefix } from '~/utils/routes';
import { watch, ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onClickOutside, useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { escapeCorpusText, safeHighlight } from '~/utils/safeHighlight';

const route = useRoute();

const { t } = useI18n();
const playerStore = usePlayerStore();
const ytPlayer = useYoutubeSegmentPlayer();
const { mediaName } = useMediaName();
const {
  currentResult,
  isPlaying,
  showPlayer,
  autoplay,
  repeat,
  isImmersive,
  currentAudio,
  playlist,
  currentIndex,
  volume,
  playbackRate,
} = storeToRefs(playerStore);

const { scrollBehavior } = useMotionPreference();

const progress = ref(0);
const animationFrameId = ref<number | null>(null);
let lastScrollTime = 0;

const handleGlobalKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (!showPlayer.value) return;

  // This window capture handler runs before menu buttons. Roles identify keys that must reach their own
  // controls. Keep Escape available for the player's innermost layer rather than returning early for every
  // key.
  const inMenu = target.closest('[role="menu"]') !== null;
  const opensMenu = target.closest('[aria-haspopup="menu"]') !== null;

  // Disable shortcuts inside menus except Escape for our open speed menu. Layout-changing shortcuts would
  // unmount the focused item; taking another menu's Escape would hide the player before that menu could
  // dismiss itself.
  if (inMenu && !(event.code === 'Escape' && rateMenuOpen.value)) return;

  switch (event.code) {
    case 'Space':
      // Not `inMenu` -- that is handled above. This is the trigger itself,
      // which needs Space to open the menu it owns. Capturing it here meant the
      // speed button answered Space by toggling playback and never opening.
      if (opensMenu) return;
      event.preventDefault();
      playerStore.togglePlay();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      playerStore.prev();
      break;
    case 'ArrowRight':
      event.preventDefault();
      playerStore.next();
      break;
    case 'KeyR':
      event.preventDefault();
      playerStore.restart();
      break;
    case 'KeyF':
      event.preventDefault();
      playerStore.toggleImmersive();
      break;
    case 'KeyL':
      event.preventDefault();
      playerStore.toggleAutoplay();
      break;
    case 'Escape': {
      // Before the modal: a player open over Context is a layer on top of
      // the dialog, so the first Escape dismisses it and the next one
      // closes the dialog. Immersive is a layer on the player, and the speed
      // menu is a layer on both -- innermost first, so Escape never closes
      // something the reader can still see an open menu in front of.
      event.preventDefault();
      event.stopPropagation();
      if (rateMenuOpen.value) rateMenuOpen.value = false;
      else if (isImmersive.value) playerStore.toggleImmersive();
      else playerStore.hidePlayer();
      break;
    }
  }
};

watch(
  () => route.path,
  (newPath) => {
    const { localizedPath } = splitLocalePrefix(newPath);
    if (showPlayer.value && !localizedPath.startsWith('/search') && !localizedPath.startsWith('/sentence')) {
      playerStore.hidePlayer();
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown, true);
});

const waitForElement = async (selector: string, retries = 5, delay = 100) => {
  for (let i = 0; i < retries; i++) {
    const element = document.getElementById(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
};

const scrollMainView = async () => {
  const now = Date.now();
  const timeSinceLastScroll = now - lastScrollTime;
  lastScrollTime = now;
  const behavior = timeSinceLastScroll < 300 ? 'instant' : scrollBehavior();

  const result = currentResult.value;
  if (!result) return;

  const mainPageElement = await waitForElement(result.segment.publicId);
  if (mainPageElement) {
    mainPageElement.scrollIntoView({ behavior, block: 'center' });
  }
};

const animationLoop = () => {
  if (!playerStore.currentAudio) return;
  updateProgress();
  animationFrameId.value = requestAnimationFrame(animationLoop);
};

const startProgressAnimation = () => {
  if (animationFrameId.value) {
    cancelAnimationFrame(animationFrameId.value);
  }
  animationFrameId.value = requestAnimationFrame(animationLoop);
};

const stopProgressAnimation = () => {
  if (animationFrameId.value) {
    cancelAnimationFrame(animationFrameId.value);
    animationFrameId.value = null;
  }
};

const onAudioEnded = () => {
  stopProgressAnimation();
  if (!repeat.value) {
    progress.value = 100;
  }
};

const SEEK_STEP = 1;

const isYoutubeActive = () => currentResult.value?.media.category === 'YOUTUBE';

const seek = (delta: number) => {
  const result = currentResult.value;
  if (isYoutubeActive() && result) {
    // Read through the resolver, not off the segment: the step is a fraction of
    // the clip, so on an expanded segment the segment's own span would move the
    // playhead by the wrong amount in both directions.
    const clip = resolveClipWindow(result);
    const span = (clip.endMs - clip.startMs) / 1000;
    if (span <= 0) return;
    const next = Math.min(Math.max(ytPlayer.clipProgress.value + delta / span, 0), 1);
    ytPlayer.seekToClipFraction(next);
    return;
  }
  const audio = playerStore.currentAudio;
  if (!audio || Number.isNaN(audio.duration)) return;

  const nextTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration);

  audio.currentTime = nextTime;
  updateProgress();
};

const seekBackward = () => seek(-SEEK_STEP);
const seekForward = () => seek(SEEK_STEP);

const seekToPercent = (percent: number) => {
  if (isYoutubeActive()) {
    ytPlayer.seekToClipFraction(percent);
    return;
  }
  const audio = playerStore.currentAudio;
  if (!audio || Number.isNaN(audio.duration)) return;

  const clamped = Math.min(Math.max(percent, 0), 1);
  audio.currentTime = audio.duration * clamped;
  updateProgress();
};

const onProgressClick = (event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percent = clickX / rect.width;

  seekToPercent(percent);
};

watch(
  currentAudio,
  (newAudio, oldAudio) => {
    if (oldAudio) {
      oldAudio.removeEventListener('play', startProgressAnimation);
      oldAudio.removeEventListener('pause', stopProgressAnimation);
      oldAudio.removeEventListener('ended', onAudioEnded);
    }
    if (newAudio) {
      progress.value = 0;
      newAudio.addEventListener('play', startProgressAnimation);
      newAudio.addEventListener('pause', stopProgressAnimation);
      newAudio.addEventListener('ended', onAudioEnded);
    }

    if (currentResult.value && oldAudio !== newAudio) {
      nextTick(() => {
        scrollMainView();
      });
    }
  },
  { immediate: false },
);

const getSentenceStyle = (index: number) => {
  if (currentIndex.value === null) return { classes: '', style: {} };

  const distance = Math.abs(index - currentIndex.value);
  const threshold = 1;

  if (distance > threshold) {
    return { classes: 'hidden', style: {} };
  }

  let classes = 'transition-all duration-500 ease-out block text-xl md:text-3xl lg:text-4xl py-4 ';
  let style = {};

  if (distance === 0) {
    classes += 'font-bold text-white leading-tight drop-shadow-lg';
    style = {
      opacity: 1,
      transform: 'scale(1)',
    };
  } else {
    classes += 'font-medium text-white/40 leading-normal';
    style = {
      opacity: 0.5,
      transform: 'scale(1)',
    };
  }

  return { classes, style };
};

const updateProgress = () => {
  if (playerStore.currentAudio) {
    const currentTime = playerStore.currentAudio.currentTime;
    const duration = playerStore.currentAudio.duration;
    if (!Number.isNaN(duration) && duration > 0) {
      progress.value = (currentTime / duration) * 100;
    }
  }
};

watch(ytPlayer.clipProgress, (p) => {
  if (currentResult.value && currentResult.value.media.category === 'YOUTUBE') {
    progress.value = p * 100;
  }
});

const getJapaneseContent = (result: any) => {
  if (!result) return '';
  return result.segment.textJa.highlight
    ? safeHighlight(result.segment.textJa.highlight)
    : escapeCorpusText(result.segment.textJa.content);
};

const getAnimeImage = (result: any) => {
  if (!result) return '';
  return result.segment.urls.imageUrl;
};

/** Use pointer capability, not viewport width: landscape phones still use hardware volume keys. */
const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

/** iOS/iPadOS silently ignore volume assignments, even with a fine pointer. Probe by writing and reading back
 * on mount. SSR has no Audio and omits the slider, so hydration agrees.
 */
const canSetVolume = ref(false);

onMounted(() => {
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    canSetVolume.value = probe.volume === 0.5;
  } catch {
    canSetVolume.value = false;
  }
});

/** Both halves have to hold: usable input, and a volume that actually moves. */
const showVolumeSlider = computed(() => hasFinePointer.value && canSetVolume.value);

const volumePercent = computed(() => Math.round(volume.value * 100));

const volumeIcon = computed(() => {
  if (volume.value === 0) return mdiVolumeOff;
  if (volume.value < 0.34) return mdiVolumeLow;
  if (volume.value < 0.67) return mdiVolumeMedium;
  return mdiVolumeHigh;
});

const onVolumeInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  playerStore.setVolume(Number(target.value) / 100);
};

/** One open state, but two wrapper refs: both layouts coexist during the 400ms leave transition. A shared ref
 * can be overwritten or nulled by the leaving branch, leaving onClickOutside with no target.
 */
const rateMenuOpen = ref(false);
const rateMenuBarRef = ref<HTMLElement | null>(null);
const rateMenuImmersiveRef = ref<HTMLElement | null>(null);

// A hidden player takes its menu with it. Without this the flag survives the
// close -- a route change or Escape hides the bar with the menu still open, and
// the next clip the reader plays brings the player back up with a speed menu
// hanging off it that nobody asked for.
watch(showPlayer, (visible) => {
  if (!visible) rateMenuOpen.value = false;
});

// Each wrapper ignores the other: for the same 400ms both are mounted, and a
// bare pair of handlers would have each read a click inside its counterpart as
// "outside" and close a menu the reader was in the middle of using.
onClickOutside(
  rateMenuBarRef,
  () => {
    rateMenuOpen.value = false;
  },
  { ignore: [rateMenuImmersiveRef] },
);

onClickOutside(
  rateMenuImmersiveRef,
  () => {
    rateMenuOpen.value = false;
  },
  { ignore: [rateMenuBarRef] },
);

/**
 * The wrapper belonging to the layout currently on screen.
 *
 * Chosen by `isImmersive` rather than by whichever ref happens to be set: for
 * the 400ms a `zoom-fade` takes to leave, both are, and the leaving one is the
 * wrong place to be putting focus.
 */
const activeRateWrapper = () => (isImmersive.value ? rateMenuImmersiveRef.value : rateMenuBarRef.value);

const rateMenuItems = () => {
  const wrapper = activeRateWrapper();
  return wrapper ? [...wrapper.querySelectorAll<HTMLElement>('[role="menuitemradio"]')] : [];
};

const rateMenuTrigger = () => activeRateWrapper()?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;

/** Move focus into the open menu. Restore it only if still inside on close, so outside clicks keep their chosen
 * focus.
 */
watch(rateMenuOpen, async (open) => {
  const trigger = rateMenuTrigger();
  if (open) {
    await nextTick();
    const items = rateMenuItems();
    const checked = items.find((item) => item.getAttribute('aria-checked') === 'true');
    (checked ?? items[0])?.focus();
    return;
  }

  const wrapper = activeRateWrapper();
  if (wrapper?.contains(document.activeElement)) trigger?.focus();
});

/** Wrap Arrow/Home/End navigation through speeds; leave Space/Enter activation to the buttons. */
const onRateMenuKeydown = (event: KeyboardEvent) => {
  const items = rateMenuItems();
  if (items.length === 0) return;

  const current = items.indexOf(document.activeElement as HTMLElement);

  const focusAt = (index: number) => {
    event.preventDefault();
    items[(index + items.length) % items.length]?.focus();
  };

  switch (event.code) {
    case 'ArrowDown':
      focusAt(current + 1);
      break;
    case 'ArrowUp':
      focusAt(current - 1);
      break;
    case 'Home':
      focusAt(0);
      break;
    case 'End':
      focusAt(items.length - 1);
      break;
    case 'Tab':
      // Close on Tab, focusing the trigger synchronously before items unmount. Do not prevent Tab: the browser
      // must continue from the trigger to the next control, not restart at body.
      rateMenuTrigger()?.focus();
      rateMenuOpen.value = false;
      break;
  }
};

const selectPlaybackRate = (rate: number) => {
  playerStore.setPlaybackRate(rate);
  rateMenuOpen.value = false;
};
</script>

<template>
        <div v-if="showPlayer && currentResult">

            <transition name="zoom-fade">
                <div v-if="isImmersive"
                    class="fixed inset-0 w-full h-[100dvh] text-white z-50 flex flex-col items-center justify-between overflow-hidden bg-neutral-950">

                    <div class="relative z-20 w-full flex justify-between items-start p-6 md:p-8">
                        <div class="flex flex-col gap-1 opacity-80">
                            <span class="text-xs font-bold tracking-widest uppercase text-white/60">{{ t('player.nowPlaying') }}</span>
                            <span lang="ja" class="text-sm font-semibold truncate max-w-[180px] md:max-w-sm">{{
                                mediaName(currentResult.media) }}</span>
                        </div>


                    </div>

                    <div
                        class="relative z-10 w-full flex-grow min-h-0 flex flex-col items-center justify-center overflow-hidden max-w-4xl mx-auto px-6">

                        <img
                            :src="getAnimeImage(currentResult)"
                            :alt="`Cover art for ${mediaName(currentResult.media)}`"
                            class="block w-auto h-auto max-w-sm md:max-w-md max-h-[28vh] md:max-h-[40vh] object-contain rounded-lg shadow-2xl ring-1 ring-white/10 opacity-90 mb-6 md:mb-1 min-h-0 transition-opacity duration-700"
                        />

                        <div class="relative w-full flex-1 min-h-0 overflow-hidden flex flex-col items-center">

                            <div
                                class="w-full h-full overflow-hidden flex flex-col justify-center mask-gradient">
                                <div
                                    class="flex flex-col items-center justify-center w-full min-h-0 py-6 transition-all duration-500">
                                    <p v-for="(sentence, index) in playlist" :key="sentence.segment.publicId"
                                        :id="`sentence-${sentence.segment.publicId}`"
                                        lang="ja"
                                        :class="getSentenceStyle(index).classes" :style="getSentenceStyle(index).style"
                                        v-html="getJapaneseContent(sentence)"
                                        class="text-center cursor-default select-none max-w-4xl mx-auto px-4">
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="relative z-20 w-full max-w-2xl px-6 pb-12 pt-6">
                        <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: preserve pointer-only seeking -->
                        <div class="w-full flex items-center gap-3 mb-6 group cursor-pointer" @click="onProgressClick">
                            <div
                                class="relative flex-grow h-1.5 bg-white/10 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
                                <div class="absolute top-0 left-0 h-full bg-red-500 rounded-full transition-all duration-100 ease-linear"
                                    :style="{ width: `${progress}%` }"></div>
                            </div>
                        </div>

                        <div class="flex items-center justify-center gap-8 md:gap-12">

                            <button type="button" @click="seekBackward" class="group p-2" :aria-label="t('player.controls.rewind')">
                                <UiBaseIcon :path="mdiRewind" :size="28"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button type="button" @click="playerStore.prev()" class="group p-2" :aria-label="t('player.controls.previous')">
                                <UiBaseIcon :path="mdiSkipPrevious" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button type="button" @click="playerStore.togglePlay()"
                                class="w-16 h-16 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-all shadow-lg shadow-white/10"
                                :aria-label="isPlaying ? t('player.controls.pause') : t('player.controls.play')">
                                <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="40" />
                            </button>

                            <button type="button" @click="playerStore.next()" class="group p-2" :aria-label="t('player.controls.next')">
                                <UiBaseIcon :path="mdiSkipNext" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button type="button" @click="seekForward" class="group p-2" :aria-label="t('player.controls.forward')">
                                <UiBaseIcon :path="mdiFastForward" :size="28"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                        </div>

                        <div class="flex items-center justify-center gap-2 mt-8">
                            <div ref="rateMenuImmersiveRef" class="relative">
                                <button type="button" @click="rateMenuOpen = !rateMenuOpen"
                                    class="px-2 py-1 rounded-full hover:bg-white/10 transition-colors text-xs font-bold tabular-nums"
                                    :class="playbackRate === 1 ? 'text-white/60' : 'text-red-400'"
                                    :aria-label="t('player.controls.speed', { rate: playbackRate })"
                                    aria-haspopup="menu" :aria-expanded="rateMenuOpen">
                                    {{ playbackRate }}×
                                </button>
                                <!-- Opens upward: the player is pinned to the bottom of the viewport, so
                                     a menu below the button would be off-screen. -->
                                <div v-if="rateMenuOpen" role="menu" :aria-label="t('player.controls.speedMenu')"
                                    @keydown="onRateMenuKeydown"
                                    class="absolute bottom-full right-0 mb-2 py-1 min-w-[4.5rem] rounded-lg bg-neutral-800 shadow-xl ring-1 ring-white/10 overflow-hidden">
                                    <button type="button" v-for="rate in PLAYBACK_RATES" :key="rate" role="menuitemradio" tabindex="-1"
                                        :aria-checked="playbackRate === rate" @click="selectPlaybackRate(rate)"
                                        class="w-full px-3 py-1.5 text-left text-xs font-bold tabular-nums hover:bg-white/10 transition-colors"
                                        :class="playbackRate === rate ? 'text-red-400' : 'text-white/70'">
                                        {{ rate }}×
                                    </button>
                                </div>
                            </div>
                            <div v-if="showVolumeSlider" class="flex items-center gap-2 px-1">
                                <UiBaseIcon :path="volumeIcon" :size="20" class="text-white/50" />
                                <input type="range" min="0" max="100" step="1" :value="volumePercent"
                                    :style="{ '--volume-fill': `${volumePercent}%` }"
                                    @input="onVolumeInput" @change="playerStore.trackVolumeChange()"
                                    class="player-volume w-20"
                                    :aria-label="t('player.controls.volume')" :aria-valuetext="`${volumePercent}%`" />
                            </div>
                            <button type="button" @click="playerStore.toggleAutoplay()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': autoplay, 'text-white/60': !autoplay }"
                                :aria-label="t('player.controls.autoplay')" :aria-pressed="autoplay">
                                <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                            </button>
                            <button type="button" @click="playerStore.toggleRepeat()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }"
                                :aria-label="t('player.controls.repeat')" :aria-pressed="repeat">
                                <UiBaseIcon :path="mdiRepeat" :size="20" />
                            </button>
                            <button type="button" @click="playerStore.toggleImmersive()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80"
                                :aria-label="t('player.controls.exitFullscreen')">
                                <UiBaseIcon :path="mdiFullscreenExit" :size="20" />
                            </button>
                            <button type="button" @click="playerStore.hidePlayer()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80"
                                :aria-label="t('player.controls.close')">
                                <UiBaseIcon :path="mdiClose" :size="20" />
                            </button>
                        </div>
                    </div>

                </div>
            </transition>

            <div v-if="!isImmersive"
                class="fixed bottom-0 left-0 right-0 bg-neutral-900/90 backdrop-blur-md text-white shadow-lg z-[70] safe-pb border-t border-white/5">
                <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: preserve pointer-only seeking -->
                <div class="w-full bg-neutral-700/30 group cursor-pointer h-1.5 hover:h-2.5 transition-all" @click="onProgressClick">
                    <div class="bg-red-500 h-full transition-all ease-linear" :style="{ width: `${progress}%` }"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between p-3 gap-3 md:px-6">
                    <div class="flex items-center gap-4 flex-grow min-w-0">
                        <img :src="getAnimeImage(currentResult)"
                            :alt="`Cover art for ${mediaName(currentResult.media)}`"
                            class="w-12 h-12 object-contain rounded-lg shadow-sm bg-neutral-950/40" />
                        <div class="flex-grow min-w-0">
                            <p lang="ja" class="font-bold text-base truncate pr-4" v-html="getJapaneseContent(currentResult)">
                            </p>
                            <p lang="ja" class="text-xs text-gray-400 truncate">{{ mediaName(currentResult.media) }}</p>
                        </div>
                    </div>


                    <!-- Full width below `md` so the two control groups each get
                         their own centred row: the bar wraps at that size, and
                         groups sized to their content wrap left-aligned, which
                         reads as two ragged clusters rather than a transport. -->
                    <div class="flex items-center justify-center gap-1 w-full md:w-auto md:gap-3">
                        <button type="button" @click="seekBackward" class="p-2 text-white/70 hover:text-white transition-colors hidden sm:inline-block" :aria-label="t('player.controls.rewind')">
                            <UiBaseIcon :path="mdiRewind" :size="24"
                                class="text-white/70 group-hover:text-white transition-colors" />
                        </button>
                        <button type="button" @click="playerStore.prev()"
                            class="p-2 text-white/70 hover:text-white transition-colors"
                            :aria-label="t('player.controls.previous')">
                            <UiBaseIcon :path="mdiSkipPrevious" :size="24" />
                        </button>
                        <button type="button" @click="playerStore.togglePlay()"
                            class="p-2 text-white hover:text-red-400 transition-colors"
                            :aria-label="isPlaying ? t('player.controls.pause') : t('player.controls.play')">
                            <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="24" />
                        </button>
                        <button type="button" @click="playerStore.next()"
                            class="p-2 text-white/70 hover:text-white transition-colors"
                            :aria-label="t('player.controls.next')">
                            <UiBaseIcon :path="mdiSkipNext" :size="24" />
                        </button>
                        <button type="button" @click="seekForward" class="p-2 text-white/70 hover:text-white transition-colors hidden sm:inline-block" :aria-label="t('player.controls.forward')">
                            <UiBaseIcon :path="mdiFastForward" :size="24"
                                class="text-white/70 group-hover:text-white transition-colors" />
                        </button>

                    </div>

                    <!-- The rule divides this group from the transport, so it is
                         only drawn while the two share a row. Wrapped, it reads
                         as a stray line hanging off the left edge. -->
                    <div
                        class="flex items-center justify-center gap-2 w-full md:w-auto md:pl-4 md:border-l md:border-white/10">
                        <div ref="rateMenuBarRef" class="relative">
                            <button type="button" @click="rateMenuOpen = !rateMenuOpen"
                                class="px-2 py-1 rounded-full hover:bg-white/10 transition-colors text-xs font-bold tabular-nums"
                                :class="playbackRate === 1 ? 'text-white/60' : 'text-red-400'"
                                :aria-label="t('player.controls.speed', { rate: playbackRate })"
                                aria-haspopup="menu" :aria-expanded="rateMenuOpen">
                                {{ playbackRate }}×
                            </button>
                            <!-- Opens upward: the player is pinned to the bottom of the viewport, so
                                 a menu below the button would be off-screen. -->
                            <div v-if="rateMenuOpen" role="menu" :aria-label="t('player.controls.speedMenu')"
                                    @keydown="onRateMenuKeydown"
                                class="absolute bottom-full right-0 mb-2 py-1 min-w-[4.5rem] rounded-lg bg-neutral-800 shadow-xl ring-1 ring-white/10 overflow-hidden">
                                <button type="button" v-for="rate in PLAYBACK_RATES" :key="rate" role="menuitemradio" tabindex="-1"
                                    :aria-checked="playbackRate === rate" @click="selectPlaybackRate(rate)"
                                    class="w-full px-3 py-1.5 text-left text-xs font-bold tabular-nums hover:bg-white/10 transition-colors"
                                    :class="playbackRate === rate ? 'text-red-400' : 'text-white/70'">
                                    {{ rate }}×
                                </button>
                            </div>
                        </div>
                        <div v-if="showVolumeSlider" class="flex items-center gap-2 px-1">
                            <UiBaseIcon :path="volumeIcon" :size="20" class="text-white/50" />
                            <input type="range" min="0" max="100" step="1" :value="volumePercent"
                                :style="{ '--volume-fill': `${volumePercent}%` }"
                                @input="onVolumeInput" @change="playerStore.trackVolumeChange()"
                                class="player-volume w-20"
                                :aria-label="t('player.controls.volume')" :aria-valuetext="`${volumePercent}%`" />
                        </div>
                        <button type="button" @click="playerStore.toggleAutoplay()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': autoplay, 'text-white/50': !autoplay }"
                            :aria-label="t('player.controls.autoplay')" :aria-pressed="autoplay">
                            <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                        </button>
                        <button type="button" @click="playerStore.toggleRepeat()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }"
                            :aria-label="t('player.controls.repeat')" :aria-pressed="repeat">
                            <UiBaseIcon :path="mdiRepeat" :size="20" />
                        </button>
                        <button type="button" @click="playerStore.toggleImmersive()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
                            :aria-label="t('player.controls.enterFullscreen')">
                            <UiBaseIcon :path="mdiFullscreen" :size="20" />
                        </button>
                        <button type="button" @click="playerStore.hidePlayer()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
                            :aria-label="t('player.controls.close')">
                            <UiBaseIcon :path="mdiClose" :size="20" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
</template>

<style scoped>
/* The gradient paints the filled track consistently across engines; native range styling does not. */
.player-volume {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
}

.player-volume::-webkit-slider-runnable-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    rgb(255 255 255 / 0.85) var(--volume-fill),
    rgb(255 255 255 / 0.2) var(--volume-fill)
  );
}

.player-volume::-moz-range-track {
  height: 0.25rem;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    rgb(255 255 255 / 0.85) var(--volume-fill),
    rgb(255 255 255 / 0.2) var(--volume-fill)
  );
}

.player-volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  background: #fff;
  /* Centres a 0.75rem thumb on the 0.25rem track. */
  margin-top: -0.25rem;
}

.player-volume::-moz-range-thumb {
  width: 0.75rem;
  height: 0.75rem;
  border: none;
  border-radius: 9999px;
  background: #fff;
}

.player-volume:focus-visible {
  outline: 2px solid rgb(248 113 113);
  outline-offset: 4px;
}
</style>
