
<script setup lang="ts">
import { usePlayerStore } from '~/stores/player';
import { mdiPlay, mdiPause, mdiSkipNext, mdiSkipPrevious, mdiClose, mdiAnimationPlay, mdiMotionPauseOutline, mdiFullscreen, mdiFullscreenExit, mdiRepeat } from '@mdi/js';
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

watch(currentAudio, (newAudio, oldAudio) => {
    if (oldAudio) {
        oldAudio.removeEventListener('play', startProgressAnimation);
        oldAudio.removeEventListener('pause', stopProgressAnimation);
        oldAudio.removeEventListener('ended', onAudioEnded);
    }
    if (newAudio) {
        progress.value = 0; // Reset progress on new audio
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

    let classes = 'transition-all duration-500 ease-out ';
    let style = {};

    if (distance === 0) {
        classes += 'font-bold text-white text-lg md:text-2xl leading-tight';
        style = {
            opacity: 1,
            transform: 'scale(1)',
        };
    } else {
        const opacity = Math.max(0.1, 1 - distance * 0.35);
        const scale = Math.max(0.95, 1 - distance * 0.02);
        classes += 'font-medium text-white/70 text-base md:text-xl leading-normal';
        style = {
            opacity,
            transform: `scale(${scale})`,
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
            
            <transition name="fade">
                <div v-if="isImmersive" class="fixed inset-0 w-full h-[100dvh] text-white z-50 flex items-center justify-center overflow-hidden p-8 md:p-12 lg:p-16">
                    <div class="absolute inset-0 z-0">
                        <img :src="getAnimeImage(currentSentence)" class="w-full h-full object-cover blur-lg scale-110 brightness-75" />
                        <div class="absolute inset-0 bg-black/80"></div>
                    </div>

                    <div class="relative z-10 w-full h-full flex flex-col md:flex-row items-center gap-4 md:gap-12 lg:gap-16">
                        <div class="w-1/2 md:w-1/3 flex-shrink-0">
                            <img :src="getAnimeImage(currentSentence) + '?width=500&height=500'" 
                                 class="w-full aspect-square object-cover rounded-2xl shadow-2xl" />
                        </div>

                        <div class="w-full md:w-2/3 h-full flex flex-col justify-center text-left max-h-full overflow-hidden">
                            <div class="relative flex-grow overflow-hidden min-h-0 flex flex-col">
                                <div class="absolute top-0 left-0 w-full h-16 md:h-24 z-20 pointer-events-none"></div>
                                
                                <div ref="lyricsContainer" class="overflow-y-auto h-full scroll-smooth no-scrollbar">
                                    <div class="flex flex-col justify-center min-h-full gap-4 md:gap-8 py-16 md:py-24">
                                        <p v-for="(sentence, index) in playlist"
                                           :key="sentence.segment_info.uuid"
                                           :id="`sentence-${sentence.segment_info.uuid}`"
                                           :class="getSentenceStyle(index).classes"
                                           :style="getSentenceStyle(index).style"
                                           v-html="getJapaneseContent(sentence)">
                                        </p>
                                    </div>
                                </div>
                                
                                <div class="absolute bottom-0 left-0 w-full h-16 md:h-24 z-20 pointer-events-none"></div>
                            </div>
                            
                            <div class="flex-shrink-0 pt-4 md:pt-8">
                                <div class="flex items-center justify-center md:justify-start gap-4">
                                    <button @click="playerStore.prev()" class="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                                        <UiBaseIcon :path="mdiSkipPrevious" :size="32" />
                                    </button>
                                    <button @click="playerStore.togglePlay()" class="w-16 h-16 md:w-20 md:h-20 flex items-center justify-center bg-red-500 rounded-full hover:bg-red-600 transition-colors shadow-lg">
                                        <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" :size="48" />
                                    </button>
                                    <button @click="playerStore.next()" class="w-12 h-12 md:w-16 md:h-16 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors">
                                        <UiBaseIcon :path="mdiSkipNext" :size="32" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="absolute top-0 left-0 right-0 z-20">
                        <div class="w-full bg-white/10">
                            <div class="bg-red-500 h-1 transition-all ease-linear" :style="{ width: progress + '%' }"></div>
                        </div>
                         <div class="flex items-center justify-end p-2 gap-2">
                             <button @click="playerStore.toggleAutoplay()" class="p-2 rounded-full hover:bg-white/10 transition-colors" :class="{'text-red-500': autoplay}">
                                <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" />
                            </button>
                            <button @click="playerStore.toggleRepeat()" class="p-2 rounded-full hover:bg-white/10 transition-colors" :class="{'!text-red-500': repeat}">
                                <UiBaseIcon :path="mdiRepeat" />
                            </button>
                            <button @click="toggleImmersive" class="p-2 rounded-full hover:bg-white/10 transition-colors">
                                <UiBaseIcon :path="mdiFullscreenExit" />
                            </button>
                            <button @click="playerStore.hidePlayer()" class="p-2 rounded-full hover:bg-white/10 transition-colors">
                                <UiBaseIcon :path="mdiClose" />
                            </button>
                        </div>
                    </div>
                </div>
            </transition>

            <div v-if="!isImmersive" class="fixed bottom-0 left-0 right-0 bg-neutral-900/90 backdrop-blur-md text-white shadow-lg z-50 safe-pb">
                <div class="w-full bg-neutral-700/50">
                    <div class="bg-red-500 h-1 transition-all ease-linear" :style="{ width: progress + '%' }"></div>
                </div>
                <div class="flex flex-wrap items-center justify-between p-2 gap-2">
                    <div class="flex items-center gap-3 flex-grow">
                        <img :src="getAnimeImage(currentSentence) + '?width=100&height=100'" class="w-12 h-12 object-cover rounded-md" />
                        <div class="flex-grow">
                            <p class="font-bold text-sm" v-html="getJapaneseContent(currentSentence)"></p>
                            <p class="text-xs text-gray-400 sm:hidden">{{ currentSentence.basic_info.name_anime_en }}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button @click="playerStore.prev()" class="p-2 rounded-full hover:bg-neutral-800 transition-colors">
                            <UiBaseIcon :path="mdiSkipPrevious" />
                        </button>
                        <button @click="playerStore.togglePlay()" class="p-3 bg-red-500 rounded-full hover:bg-red-600 transition-colors">
                            <UiBaseIcon :path="isPlaying ? mdiPause : mdiPlay" />
                        </button>
                        <button @click="playerStore.next()" class="p-2 rounded-full hover:bg-neutral-800 transition-colors">
                            <UiBaseIcon :path="mdiSkipNext" />
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <button @click="playerStore.toggleAutoplay()" class="p-2 rounded-full hover:bg-neutral-800 transition-colors" :class="{'text-red-500': autoplay}">
                            <UiBaseIcon :path="autoplay ? mdiAnimationPlay : mdiMotionPauseOutline" />
                        </button>
                        <button @click="playerStore.toggleRepeat()" class="p-2 rounded-full hover:bg-neutral-800 transition-colors" :class="{'!text-red-500': repeat}">
                            <UiBaseIcon :path="mdiRepeat" />
                        </button>
                        <button @click="toggleImmersive" class="p-2 rounded-full hover:bg-neutral-800 transition-colors">
                            <UiBaseIcon :path="mdiFullscreen" />
                        </button>
                        <button @click="playerStore.hidePlayer()" class="p-2 rounded-full hover:bg-neutral-800 transition-colors">
                            <UiBaseIcon :path="mdiClose" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<style>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.safe-pb {
    padding-bottom: env(safe-area-inset-bottom);
}
</style>