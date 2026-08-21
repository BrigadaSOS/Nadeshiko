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
import { PLAYBACK_RATES, usePlayerStore } from '~/stores/player';
import { splitLocalePrefix } from '~/utils/routes';
import { watch, ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onClickOutside, useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';

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

  // Keys a menu owns, and must therefore not be captured from it.
  //
  // This handler is bound with `capture: true`, so its `preventDefault()` lands
  // before the button does and no click is synthesized. For an ordinary
  // transport button that costs nothing -- Space toggling playback is what it
  // would have done anyway -- but a `role="menuitemradio"` needs Space to pick
  // an item, and its trigger needs Space to open the menu at all. Tag names
  // cannot tell any of these apart, so the test is the role each element is
  // standing in.
  //
  // ANY menu, not just this component's. The listener is on `window`, so
  // `target` is whatever holds focus anywhere on the page and these match the
  // search dropdowns and visibility menus too. That is the point rather than an
  // oversight: with the player open, Space on one of those triggers was being
  // captured into `togglePlay` and the dropdown never opened.
  //
  // Deliberately per-key rather than one bail at the top of the handler: Escape
  // below is how a menu is dismissed from the keyboard, and it also has to
  // reach its own `stopPropagation()` -- that call is what keeps an underlying
  // `BaseModal` from closing instead, which is the "innermost first" ordering
  // its comment describes. Returning early for every key inverted exactly that.
  const inMenu = target.closest('[role="menu"]') !== null;
  const opensMenu = target.closest('[aria-haspopup="menu"]') !== null;

  switch (event.code) {
    case 'Space':
      if (inMenu || opensMenu) return;
      event.preventDefault();
      playerStore.togglePlay();
      break;
    case 'ArrowLeft':
      // Skipping tracks from inside an open menu is not what the arrow was
      // reached for, whether or not the menu answers it yet.
      if (inMenu) return;
      event.preventDefault();
      playerStore.prev();
      break;
    case 'ArrowRight':
      if (inMenu) return;
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
  const seg = currentResult.value?.segment;
  if (isYoutubeActive() && seg) {
    const span = (seg.endTimeMs - seg.startTimeMs) / 1000;
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

  // Mantenemos el mismo tamaño de fuente para todas
  let classes = 'transition-all duration-500 ease-out block text-xl md:text-3xl lg:text-4xl py-4 ';
  let style = {};

  if (distance === 0) {
    // Activa: Blanco brillante
    classes += 'font-bold text-white leading-tight drop-shadow-lg';
    style = {
      opacity: 1,
      transform: 'scale(1)',
    };
  } else {
    // Inactivas: Gris oscuro y translúcido
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
  return result.segment.textJa.highlight || result.segment.textJa.content || '';
};

const getAnimeImage = (result: any) => {
  if (!result) return '';
  return result.segment.urls.imageUrl;
};

/**
 * Whether this device has a mouse-like pointer, gating the volume slider.
 *
 * Not a width breakpoint: the thing that decides whether this control can work
 * is the input, not the viewport. A phone in landscape is wide enough for `md:`
 * and still cannot use it -- iOS treats `HTMLMediaElement.volume` as read-only,
 * so the slider would move and nothing would happen. Touch devices keep their
 * hardware volume keys, which is the better control there anyway.
 */
const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

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

/**
 * The speed menu's open state, shared by both layouts, and a wrapper ref per
 * layout.
 *
 * One open flag is right -- the menu is one control wherever it is drawn. One
 * ref is not: the two layouts are separate `v-if`s rather than a `v-if`/`v-else`
 * pair, and the immersive branch sits inside a 400ms `zoom-fade` transition, so
 * leaving immersive mounts the bar while the immersive markup is still on its
 * way out. For that window both wrappers exist, and a single ref would hold
 * whichever one Vue assigned last -- then be nulled outright by the leaving
 * branch's unmount, since Vue queues ref assignment as a post-render effect but
 * unsets synchronously. `onClickOutside` would be left watching nothing.
 */
const rateMenuOpen = ref(false);
const rateMenuBarRef = ref<HTMLElement | null>(null);
const rateMenuImmersiveRef = ref<HTMLElement | null>(null);

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
                            <span class="text-xs font-bold tracking-widest uppercase text-white/60">Now Playing</span>
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
                        <div class="w-full flex items-center gap-3 mb-6 group cursor-pointer"  @click="onProgressClick">
                            <div
                                class="relative flex-grow h-1.5 bg-white/10 rounded-full overflow-hidden group-hover:h-2.5 transition-all">
                                <div class="absolute top-0 left-0 h-full bg-red-500 rounded-full transition-all duration-100 ease-linear"
                                    :style="{ width: progress + '%' }"></div>
                            </div>
                        </div>

                        <div class="flex items-center justify-center gap-8 md:gap-12">

                            <button @click="seekBackward" class="group p-2" :aria-label="t('player.controls.rewind')">
                                <UiBaseIcon :path="mdiRewind" :size="28"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="playerStore.prev()" class="group p-2" :aria-label="t('player.controls.previous')">
                                <UiBaseIcon :path="mdiSkipPrevious" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="playerStore.togglePlay()"
                                class="w-16 h-16 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-all shadow-lg shadow-white/10"
                                :aria-label="isPlaying ? t('player.controls.pause') : t('player.controls.play')">
                                <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="40" />
                            </button>

                            <button @click="playerStore.next()" class="group p-2" :aria-label="t('player.controls.next')">
                                <UiBaseIcon :path="mdiSkipNext" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="seekForward" class="group p-2" :aria-label="t('player.controls.forward')">
                                <UiBaseIcon :path="mdiFastForward" :size="28"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                        </div>

                        <div class="flex items-center justify-center gap-2 mt-8">
                            <div ref="rateMenuImmersiveRef" class="relative">
                                <button @click="rateMenuOpen = !rateMenuOpen"
                                    class="px-2 py-1 rounded-full hover:bg-white/10 transition-colors text-xs font-bold tabular-nums"
                                    :class="playbackRate === 1 ? 'text-white/60' : 'text-red-400'"
                                    :aria-label="t('player.controls.speed', { rate: playbackRate })"
                                    aria-haspopup="menu" :aria-expanded="rateMenuOpen">
                                    {{ playbackRate }}×
                                </button>
                                <!-- Opens upward: the player is pinned to the bottom of the viewport, so
                                     a menu below the button would be off-screen. -->
                                <div v-if="rateMenuOpen" role="menu" :aria-label="t('player.controls.speedMenu')"
                                    class="absolute bottom-full right-0 mb-2 py-1 min-w-[4.5rem] rounded-lg bg-neutral-800 shadow-xl ring-1 ring-white/10 overflow-hidden">
                                    <button v-for="rate in PLAYBACK_RATES" :key="rate" role="menuitemradio"
                                        :aria-checked="playbackRate === rate" @click="selectPlaybackRate(rate)"
                                        class="w-full px-3 py-1.5 text-left text-xs font-bold tabular-nums hover:bg-white/10 transition-colors"
                                        :class="playbackRate === rate ? 'text-red-400' : 'text-white/70'">
                                        {{ rate }}×
                                    </button>
                                </div>
                            </div>
                            <div v-if="hasFinePointer" class="flex items-center gap-2 px-1">
                                <UiBaseIcon :path="volumeIcon" :size="20" class="text-white/50" />
                                <input type="range" min="0" max="100" step="1" :value="volumePercent"
                                    :style="{ '--volume-fill': volumePercent + '%' }"
                                    @input="onVolumeInput" @change="playerStore.trackVolumeChange()"
                                    class="player-volume w-20"
                                    :aria-label="t('player.controls.volume')" :aria-valuetext="`${volumePercent}%`" />
                            </div>
                            <button @click="playerStore.toggleAutoplay()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': autoplay, 'text-white/60': !autoplay }"
                                :aria-label="t('player.controls.autoplay')" :aria-pressed="autoplay">
                                <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                            </button>
                            <button @click="playerStore.toggleRepeat()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }"
                                :aria-label="t('player.controls.repeat')" :aria-pressed="repeat">
                                <UiBaseIcon :path="mdiRepeat" :size="20" />
                            </button>
                            <button @click="playerStore.toggleImmersive()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80"
                                :aria-label="t('player.controls.exitFullscreen')">
                                <UiBaseIcon :path="mdiFullscreenExit" :size="20" />
                            </button>
                            <button @click="playerStore.hidePlayer()"
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
                <div class="w-full bg-neutral-700/30 group cursor-pointer h-1.5 hover:h-2.5 transition-all" @click="onProgressClick">
                    <div class="bg-red-500 h-full transition-all ease-linear" :style="{ width: progress + '%' }"></div>
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
                        <button @click="seekBackward" class="p-2 text-white/70 hover:text-white transition-colors hidden sm:inline-block" :aria-label="t('player.controls.rewind')">
                            <UiBaseIcon :path="mdiRewind" :size="24"
                                class="text-white/70 group-hover:text-white transition-colors" />
                        </button>
                        <button @click="playerStore.prev()"
                            class="p-2 text-white/70 hover:text-white transition-colors"
                            :aria-label="t('player.controls.previous')">
                            <UiBaseIcon :path="mdiSkipPrevious" :size="24" />
                        </button>
                        <button @click="playerStore.togglePlay()"
                            class="p-2 text-white hover:text-red-400 transition-colors"
                            :aria-label="isPlaying ? t('player.controls.pause') : t('player.controls.play')">
                            <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="24" />
                        </button>
                        <button @click="playerStore.next()"
                            class="p-2 text-white/70 hover:text-white transition-colors"
                            :aria-label="t('player.controls.next')">
                            <UiBaseIcon :path="mdiSkipNext" :size="24" />
                        </button>
                        <button @click="seekForward" class="p-2 text-white/70 hover:text-white transition-colors hidden sm:inline-block" :aria-label="t('player.controls.forward')">
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
                            <button @click="rateMenuOpen = !rateMenuOpen"
                                class="px-2 py-1 rounded-full hover:bg-white/10 transition-colors text-xs font-bold tabular-nums"
                                :class="playbackRate === 1 ? 'text-white/60' : 'text-red-400'"
                                :aria-label="t('player.controls.speed', { rate: playbackRate })"
                                aria-haspopup="menu" :aria-expanded="rateMenuOpen">
                                {{ playbackRate }}×
                            </button>
                            <!-- Opens upward: the player is pinned to the bottom of the viewport, so
                                 a menu below the button would be off-screen. -->
                            <div v-if="rateMenuOpen" role="menu" :aria-label="t('player.controls.speedMenu')"
                                class="absolute bottom-full right-0 mb-2 py-1 min-w-[4.5rem] rounded-lg bg-neutral-800 shadow-xl ring-1 ring-white/10 overflow-hidden">
                                <button v-for="rate in PLAYBACK_RATES" :key="rate" role="menuitemradio"
                                    :aria-checked="playbackRate === rate" @click="selectPlaybackRate(rate)"
                                    class="w-full px-3 py-1.5 text-left text-xs font-bold tabular-nums hover:bg-white/10 transition-colors"
                                    :class="playbackRate === rate ? 'text-red-400' : 'text-white/70'">
                                    {{ rate }}×
                                </button>
                            </div>
                        </div>
                        <div v-if="hasFinePointer" class="flex items-center gap-2 px-1">
                            <UiBaseIcon :path="volumeIcon" :size="20" class="text-white/50" />
                            <input type="range" min="0" max="100" step="1" :value="volumePercent"
                                :style="{ '--volume-fill': volumePercent + '%' }"
                                @input="onVolumeInput" @change="playerStore.trackVolumeChange()"
                                class="player-volume w-20"
                                :aria-label="t('player.controls.volume')" :aria-valuetext="`${volumePercent}%`" />
                        </div>
                        <button @click="playerStore.toggleAutoplay()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': autoplay, 'text-white/50': !autoplay }"
                            :aria-label="t('player.controls.autoplay')" :aria-pressed="autoplay">
                            <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                        </button>
                        <button @click="playerStore.toggleRepeat()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }"
                            :aria-label="t('player.controls.repeat')" :aria-pressed="repeat">
                            <UiBaseIcon :path="mdiRepeat" :size="20" />
                        </button>
                        <button @click="playerStore.toggleImmersive()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70"
                            :aria-label="t('player.controls.enterFullscreen')">
                            <UiBaseIcon :path="mdiFullscreen" :size="20" />
                        </button>
                        <button @click="playerStore.hidePlayer()"
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
/*
 * The volume slider.
 *
 * Hand-styled because a native range input renders as a platform-coloured form
 * control, which in the middle of the player bar reads as a stray input rather
 * than part of the transport. The track carries its own fill (a hard-stopped
 * gradient driven by `--volume-fill`) since neither engine paints the portion
 * left of the thumb on its own, and an unfilled track gives no read on the
 * level at a glance.
 */
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
