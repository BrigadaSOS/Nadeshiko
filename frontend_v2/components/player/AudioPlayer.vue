<script setup lang="ts">
import { usePlayerStore } from '~/stores/player';
import { mdiPlay, mdiFastForward, mdiRewind, mdiPause, mdiSkipNext, mdiSkipPrevious, mdiClose, mdiAnimationPlay, mdiMotionPauseOutline, mdiFullscreen, mdiFullscreenExit, mdiRepeat } from '@mdi/js';
import { watch, ref, nextTick } from 'vue';
import { storeToRefs } from 'pinia';

const playerStore = usePlayerStore();
const { currentSentence, isPlaying, showPlayer, autoplay, currentAudio, playlist, currentIndex, repeat } = storeToRefs(playerStore);

const progress = ref(0);
const isImmersive = ref(false);
const lyricsContainer = ref<HTMLElement | null>(null);
const animationFrameId = ref<number | null>(null);

const toggleImmersive = () => {
    isImmersive.value = !isImmersive.value;
};

const waitForElement = async (selector: string, retries = 5, delay = 100) => {
    for (let i = 0; i < retries; i++) {
        const element = document.getElementById(selector);
        if (element) return element;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    return null;
};

const scrollImmersiveView = async () => {
    const sentence = currentSentence.value;
    if (!sentence || !lyricsContainer.value) return;

    const elementId = `sentence-${sentence.segment_info.uuid}`;
    const immersiveElement = await waitForElement(elementId);

    if (immersiveElement) {
        const containerHeight = lyricsContainer.value.clientHeight;
        const elementTop = immersiveElement.offsetTop;
        const elementHeight = immersiveElement.clientHeight;

        lyricsContainer.value.scrollTo({
            top: elementTop - (containerHeight / 2) + (elementHeight / 2),
            behavior: 'smooth'
        });
    }
};

const scrollMainView = async () => {
    const sentence = currentSentence.value;
    if (!sentence) return;

    const mainPageElement = await waitForElement(sentence.segment_info.uuid);
    if (mainPageElement) {
        mainPageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

watch(isImmersive, (isImmersive) => {
    if (isImmersive) {
        nextTick(() => {
            scrollImmersiveView();
        });
    }
});

const SEEK_STEP = 1;

const seek = (delta: number) => {
    const audio = playerStore.currentAudio;
    if (!audio || isNaN(audio.duration)) return;

    const nextTime = Math.min(
        Math.max(audio.currentTime + delta, 0),
        audio.duration
    );

    audio.currentTime = nextTime;
    updateProgress();
};

const seekBackward = () => seek(-SEEK_STEP);
const seekForward = () => seek(SEEK_STEP);

const seekToPercent = (percent: number) => {
    const audio = playerStore.currentAudio;
    if (!audio || isNaN(audio.duration)) return;

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


watch(currentAudio, (newAudio, oldAudio) => {
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

    if (currentSentence.value && (oldAudio !== newAudio)) {
        nextTick(() => {
            scrollMainView();
            if (isImmersive.value) {
                scrollImmersiveView();
            }
        });
    }
}, { immediate: false });

const getSentenceStyle = (index: number) => {
    if (currentIndex.value === null) return { classes: '', style: {} };

    const distance = Math.abs(index - currentIndex.value);
    const threshold = 1;

    if (distance > threshold) {
        return { classes: 'hidden', style: {} };
    }

    // Mantenemos el mismo tamaño de fuente para todas
    let classes = 'transition-all duration-500 ease-out block text-xl md:text-3xl lg:text-4xl py-6 ';
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
        if (!isNaN(duration) && duration > 0) {
            progress.value = (currentTime / duration) * 100;
        }
    }
};

const getJapaneseContent = (sentence: any) => {
    if (!sentence) return '';
    return sentence.segment_info.content_jp_highlight || sentence.segment_info.content_jp || '';
};

const getAnimeImage = (sentence: any) => {
    if (!sentence) return '';
    return sentence.media_info.path_image;
}

</script>

<template>
    <transition name="fade">
        <div v-if="showPlayer && currentSentence">

            <transition name="zoom-fade">
                <div v-if="isImmersive"
                    class="fixed inset-0 w-full h-[100dvh] text-white z-50 flex flex-col items-center justify-between overflow-hidden bg-neutral-950">

                    <div class="absolute inset-0 z-0 select-none pointer-events-none">
                    </div>

                    <div class="relative z-20 w-full flex justify-between items-start p-6 md:p-8">
                        <div class="flex flex-col gap-1 opacity-80">
                            <span class="text-xs font-bold tracking-widest uppercase text-white/60">Now Playing</span>
                            <span class="text-sm font-semibold truncate max-w-[200px]">{{
                                currentSentence.basic_info.name_anime_en }}</span>
                        </div>

                        <div
                            class="flex items-center gap-2 bg-white/5 backdrop-blur-md rounded-full p-1 border border-white/10">
                            <button @click="playerStore.toggleAutoplay()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': autoplay, 'text-white/60': !autoplay }" title="Autoplay">
                                <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                            </button>
                            <button @click="playerStore.toggleRepeat()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors"
                                :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }" title="Repeat">
                                <UiBaseIcon :path="mdiRepeat" :size="20" />
                            </button>
                            <div class="w-px h-4 bg-white/20 mx-1"></div>
                            <button @click="toggleImmersive"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80">
                                <UiBaseIcon :path="mdiFullscreenExit" :size="20" />
                            </button>
                            <button @click="playerStore.hidePlayer()"
                                class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/80">
                                <UiBaseIcon :path="mdiClose" :size="20" />
                            </button>
                        </div>
                    </div>

                    <div
                        class="relative z-10 w-full flex-grow flex flex-col items-center justify-center overflow-hidden max-w-4xl mx-auto px-6">

                        <div
                            class="flex-shrink-0 mb-6 md:mb-1 shadow-2xl overflow-hidden hidden md:block transition-all duration-700 ring-1 ring-white/10">
                            <img :src="getAnimeImage(currentSentence)" class="w-full h-full object-fit opacity-90" />
                        </div>

                        <div class="relative w-full h-full overflow-hidden flex flex-col items-center">

                            <div ref="lyricsContainer"
                                class="w-full h-full overflow-y-auto no-scrollbar scroll-smooth flex flex-col justify-center mask-gradient">
                                <div
                                    class="flex flex-col items-center justify-center w-full min-h-0 py-12 transition-all duration-500">
                                    <p v-for="(sentence, index) in playlist" :key="sentence.segment_info.uuid"
                                        :id="`sentence-${sentence.segment_info.uuid}`"
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

                            <button @click="seekBackward" class="group p-2">
                                <UiBaseIcon :path="mdiRewind" :size="28"
                                    class="text-white/60 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="playerStore.prev()" class="group p-2">
                                <UiBaseIcon :path="mdiSkipPrevious" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="playerStore.togglePlay()"
                                class="w-16 h-16 flex items-center justify-center bg-white text-black rounded-full hover:scale-105 transition-all shadow-lg shadow-white/10">
                                <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="40" />
                            </button>

                            <button @click="playerStore.next()" class="group p-2">
                                <UiBaseIcon :path="mdiSkipNext" :size="36"
                                    class="text-white/50 group-hover:text-white transition-colors" />
                            </button>

                            <button @click="seekForward" class="group p-2">
                                <UiBaseIcon :path="mdiFastForward" :size="28"
                                    class="text-white/60 group-hover:text-white transition-colors" />
                            </button>

                        </div>
                    </div>

                </div>
            </transition>

            <div v-if="!isImmersive"
                class="fixed bottom-0 left-0 right-0 bg-neutral-900/90 backdrop-blur-md text-white shadow-lg z-50 safe-pb border-t border-white/5">
                <div class="w-full bg-neutral-700/30 group cursor-pointer h-1.5 hover:h-2.5 transition-all" @click="onProgressClick">
                    <div class="bg-red-500 h-full transition-all ease-linear" :style="{ width: progress + '%' }"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between p-3 gap-3 md:px-6">
                    <div class="flex items-center gap-4 flex-grow min-w-0">
                        <img :src="getAnimeImage(currentSentence) + '?width=100&height=100'"
                            class="w-12 h-12 object-cover rounded-lg shadow-sm" />
                        <div class="flex-grow min-w-0">
                            <p class="font-bold text-base truncate pr-4" v-html="getJapaneseContent(currentSentence)">
                            </p>
                            <p class="text-xs text-gray-400 truncate">{{ currentSentence.basic_info.name_anime_en }}</p>
                        </div>
                    </div>

                    <button @click="seekBackward" class="group p-2">
                        <UiBaseIcon :path="mdiRewind" :size="28"
                            class="text-white/60 group-hover:text-white transition-colors" />
                    </button>
                    <div class="flex items-center gap-1 md:gap-3">
                        <button @click="playerStore.prev()"
                            class="p-2 text-white/70 hover:text-white transition-colors">
                            <UiBaseIcon :path="mdiSkipPrevious" :size="24" />
                        </button>
                        <button @click="playerStore.togglePlay()"
                            class="p-2 text-white hover:text-red-400 transition-colors">
                            <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="24" />
                        </button>
                        <button @click="playerStore.next()"
                            class="p-2 text-white/70 hover:text-white transition-colors">
                            <UiBaseIcon :path="mdiSkipNext" :size="24" />
                        </button>
                        <button @click="seekForward" class="group p-2">
                            <UiBaseIcon :path="mdiFastForward" :size="28"
                                class="text-white/60 group-hover:text-white transition-colors" />
                        </button>

                    </div>

                    <div class="sm:flex items-center gap-2 pl-4 border-l border-white/10">
                        <button @click="playerStore.toggleAutoplay()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': autoplay, 'text-white/50': !autoplay }">
                            <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" :size="20" />
                        </button>
                        <button @click="playerStore.toggleRepeat()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors"
                            :class="{ 'text-red-400': repeat, 'text-white/60': !repeat }" title="Repeat">
                            <UiBaseIcon :path="mdiRepeat" :size="20" />
                        </button>
                        <button @click="toggleImmersive"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70">
                            <UiBaseIcon :path="mdiFullscreen" :size="20" />
                        </button>
                        <button @click="playerStore.hidePlayer()"
                            class="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70">
                            <UiBaseIcon :path="mdiClose" :size="20" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

.zoom-fade-enter-active,
.zoom-fade-leave-active {
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.zoom-fade-enter-from,
.zoom-fade-leave-to {
    opacity: 0;
    transform: scale(0.95);
    filter: blur(10px);
}

.no-scrollbar::-webkit-scrollbar {
    display: none;
}

.no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
}

/* Volví a añadir la máscara de gradiente al texto para que se desvanezca suavemente en los bordes superior e inferior sobre el fondo negro */
.mask-gradient {
    mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%);
}

.safe-pb {
    padding-bottom: env(safe-area-inset-bottom);
}
</style>