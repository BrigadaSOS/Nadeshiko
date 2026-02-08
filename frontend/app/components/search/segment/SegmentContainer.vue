<script setup lang="ts">
import { mdiVolumeHigh, mdiTranslate } from '@mdi/js';

import { usePlayerStore } from '~/stores/player';
import type { ResponseV1, Sentence } from '~/stores/search';

type Props = {
  searchData: ResponseV1 | null;
  isLoading: boolean;
  currentSentenceIndex?: number | null;
};

// const props = defineProps(['searchData', 'ankiNotesQuery', 'isLoading']);
const props = defineProps<Props>();
const { locale } = useI18n();

const playerStore = usePlayerStore();
const { isPlaying, currentSentence } = storeToRefs(playerStore);

const selectedSentence = ref<Sentence | null>(null);
const searchNoteSentence = ref<Sentence | null>(null);

type OrderedSegment = {
  content: 'contentEs' | 'contentEn';
  highlight: 'contentEsHighlight' | 'contentEnHighlight';
  mt: 'contentEsMt' | 'contentEnMt';
};

// Order segment according to website language
const orderedSegments = computed<OrderedSegment[]>(() => {
  const spanishSegment: OrderedSegment = {
    content: 'contentEs',
    highlight: 'contentEsHighlight',
    mt: 'contentEsMt',
  };
  const englishSegment: OrderedSegment = {
    content: 'contentEn',
    highlight: 'contentEnHighlight',
    mt: 'contentEnMt',
  };

  if (locale.value === 'en') {
    return [englishSegment, spanishSegment];
  }
  return [spanishSegment, englishSegment];
});

const openModal = (content: Sentence) => {
  selectedSentence.value = content;
};

const openAnkiModal = (sentence: Sentence) => {
  searchNoteSentence.value = sentence;
};

const apiSearch = useApiSearch();

interface IORiginalContent {
  contentJp: string;
  contentEn: string;
  contentEs: string;
  contentJpHighlight: string;
  contentEnHighlight: string;
  contentEsHighlight: string;
}

interface IConcatenation {
  sentence: Sentence | null;
  originalContent: IORiginalContent | null;
}

let activeConcatenation: IConcatenation = {
  sentence: null,
  originalContent: null,
};

const revertActiveConcatenation = () => {
  if (activeConcatenation.sentence && activeConcatenation.originalContent) {
    // We free the current url/blob
    if (activeConcatenation.sentence.mediaInfo.blobAudioUrl) {
      window.URL.revokeObjectURL(activeConcatenation.sentence.mediaInfo.blobAudioUrl);
    }

    // Revert the sentence info to the original
    activeConcatenation.sentence.mediaInfo.blobAudioUrl = null;
    activeConcatenation.sentence.mediaInfo.blobAudio = null;

    activeConcatenation.sentence.segmentInfo = {
      ...activeConcatenation.sentence.segmentInfo,
      contentJp: activeConcatenation.originalContent.contentJp,
      contentEn: activeConcatenation.originalContent.contentEn,
      contentEs: activeConcatenation.originalContent.contentEs,
      contentJpHighlight: activeConcatenation.originalContent.contentJpHighlight,
      contentEnHighlight: activeConcatenation.originalContent.contentEnHighlight,
      contentEsHighlight: activeConcatenation.originalContent.contentEsHighlight,
    };

    activeConcatenation = { sentence: null, originalContent: null };
  }
};

// Filter navigation method
const router = useRouter();
const route = useRoute();

const filterByMedia = (mediaId: number, episode?: number) => {
  const query: Record<string, string | number | string[] | number[] | undefined> = { ...route.query, media: mediaId };

  // Clear episode when selecting only media
  delete query.episode;

  if (episode !== undefined) {
    query.episode = episode;
  }

  router.push({ query });
};

const _isConcatenated = (sentence: Sentence) => {
  return activeConcatenation.sentence === sentence;
};

/// This function is called when the user wants to expand the current sentence
const loadNextSentence = async (sentence: Sentence, direction: 'forward' | 'backward' | 'both') => {
  if (props.isLoading) {
    return;
  }

  // Revertir cualquier concatenación activa antes de proceder
  revertActiveConcatenation();

  document.querySelectorAll('#concatenate-button').forEach((e) => {
    (e as HTMLButtonElement).disabled = true;
  });

  const audioUrls: string[] = [sentence.mediaInfo.pathAudio];

  try {
    const response = await apiSearch.getContextSentence({
      mediaId: sentence.basicInfo.animeId,
      episode: sentence.basicInfo.episode,
      segmentPosition: sentence.segmentInfo.position,
      limit: 1, // Fetch three sentences: previous, current, and next
    });

    if (response && response.sentences.length > 0) {
      const previousSentence = response.sentences[0];
      const nextSentence = response.sentences[2];

      // Save the original content before concatenating
      activeConcatenation = {
        sentence,
        originalContent: {
          contentJp: sentence.segmentInfo.contentJp,
          contentEn: sentence.segmentInfo.contentEn,
          contentEs: sentence.segmentInfo.contentEs,
          contentJpHighlight: sentence.segmentInfo.contentJpHighlight,
          contentEnHighlight: sentence.segmentInfo.contentEnHighlight,
          contentEsHighlight: sentence.segmentInfo.contentEsHighlight,
        },
      };

      let concatenatedAudio: Awaited<ReturnType<typeof concatenateAudios>> | null = null;

      // Concatenate according to the specified direction
      if (direction === 'forward') {
        if (!nextSentence) {
          return;
        }
        audioUrls.push(nextSentence.mediaInfo.pathAudio);
        concatenatedAudio = await concatenateAudios(audioUrls);

        sentence.segmentInfo = {
          ...sentence.segmentInfo,
          contentJp: `${sentence.segmentInfo.contentJp} <span class="text-cyan-200">${nextSentence.segmentInfo.contentJp}</span>`,
          contentEn: `${sentence.segmentInfo.contentEn} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEn}</span>`,
          contentEs: `${sentence.segmentInfo.contentEs} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEs}</span>`,
          contentJpHighlight: `${sentence.segmentInfo.contentJpHighlight || sentence.segmentInfo.contentJp} <span class="text-cyan-200">${nextSentence.segmentInfo.contentJpHighlight || nextSentence.segmentInfo.contentJp}</span>`,
          contentEnHighlight: `${sentence.segmentInfo.contentEnHighlight || sentence.segmentInfo.contentEn} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEnHighlight || nextSentence.segmentInfo.contentEn}</span>`,
          contentEsHighlight: `${sentence.segmentInfo.contentEsHighlight || sentence.segmentInfo.contentEs} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEsHighlight || nextSentence.segmentInfo.contentEs}</span>`,
        };
      } else if (direction === 'backward') {
        if (!previousSentence) {
          return;
        }
        audioUrls.unshift(previousSentence.mediaInfo.pathAudio);
        concatenatedAudio = await concatenateAudios(audioUrls);

        sentence.segmentInfo = {
          ...sentence.segmentInfo,
          contentJp: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentJp}</span> ${sentence.segmentInfo.contentJp}`,
          contentEn: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEn}</span> ${sentence.segmentInfo.contentEn}`,
          contentEs: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEs}</span> ${sentence.segmentInfo.contentEs}`,
          contentJpHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentJpHighlight || previousSentence.segmentInfo.contentJp}</span> ${sentence.segmentInfo.contentJpHighlight || sentence.segmentInfo.contentJp}`,
          contentEnHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEnHighlight || previousSentence.segmentInfo.contentEn}</span> ${sentence.segmentInfo.contentEnHighlight || sentence.segmentInfo.contentEn}`,
          contentEsHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEsHighlight || previousSentence.segmentInfo.contentEs}</span> ${sentence.segmentInfo.contentEsHighlight || sentence.segmentInfo.contentEs}`,
        };
      } else if (direction === 'both') {
        if (!previousSentence || !nextSentence) {
          return;
        }
        // Expandir en ambas direcciones
        audioUrls.unshift(previousSentence.mediaInfo.pathAudio);
        audioUrls.push(nextSentence.mediaInfo.pathAudio);

        concatenatedAudio = await concatenateAudios(audioUrls);
        sentence.segmentInfo = {
          ...sentence.segmentInfo,
          contentJp: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentJp}</span> ${sentence.segmentInfo.contentJp} <span class="text-cyan-200">${nextSentence.segmentInfo.contentJp}</span>`,
          contentEn: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEn}</span> ${sentence.segmentInfo.contentEn} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEn}</span>`,
          contentEs: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEs}</span> ${sentence.segmentInfo.contentEs} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEs}</span>`,
          contentJpHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentJp}</span>  ${sentence.segmentInfo.contentJpHighlight || sentence.segmentInfo.contentJp} <span class="text-cyan-200">${nextSentence.segmentInfo.contentJpHighlight || nextSentence.segmentInfo.contentJp}</span>`,
          contentEnHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEn}</span> ${sentence.segmentInfo.contentEnHighlight || sentence.segmentInfo.contentEn} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEnHighlight || nextSentence.segmentInfo.contentEn}</span>`,
          contentEsHighlight: `<span class="text-cyan-200">${previousSentence.segmentInfo.contentEs}</span> ${sentence.segmentInfo.contentEsHighlight || sentence.segmentInfo.contentEs} <span class="text-cyan-200">${nextSentence.segmentInfo.contentEsHighlight || nextSentence.segmentInfo.contentEs}</span>`,
        };
      }

      if (concatenatedAudio) {
        sentence.mediaInfo.blobAudioUrl = concatenatedAudio.blob_url;
        sentence.mediaInfo.blobAudio = concatenatedAudio.blob;
      }
    }
  } catch (error) {
    // Reset active concatenation
    activeConcatenation = { sentence: null, originalContent: null };
    console.error('Error fetching context sentences:', error);
  } finally {
    document.querySelectorAll('#concatenate-button').forEach((e) => {
      (e as HTMLButtonElement).disabled = false;
    });
  }
};
</script>
<template>
  <div v-if="(searchData?.sentences?.length ?? 0) > 0 && searchData">

    <SearchModalContext :sentence="selectedSentence" />

    <SearchModalAnkiNotes :sentence="searchNoteSentence"
      :onClick="(sentence: Sentence, id: number) => ankiStore().addSentenceToAnki(sentence, id)" />

    <div v-for="(sentence, index) in searchData.sentences" :key="sentence.segmentInfo.uuid"
      :id="sentence.segmentInfo.uuid"
      class="hover:bg-neutral-800/20 items-stretch b-2 rounded-lg group transition-all  flex flex-col lg:flex-row py-2"
      :class="{ 'bg-neutral-800 hover:bg-neutral-800': currentSentence && sentence.segmentInfo.uuid === currentSentence.segmentInfo.uuid }">
      <!-- Image -->
      <div class="h-auto shrink-0 w-auto lg:w-[25rem] min-w-[200px] min-h-[140px] flex justify-center">
        <img loading="lazy" :src="sentence.mediaInfo.pathImage"
          @click="zoomImage(sentence.mediaInfo.pathImage)"
          class="inset-0 h-56 w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
          :key="sentence.mediaInfo.pathImage" />
      </div>
      <!-- End Image -->

      <!-- Details -->
      <div class="w-full py-3 sm:py-2 px-4 rounded-e-lg text-white flex flex-col justify-between">
        <div>
          <!-- First Row -->
          <div class="flex items-center justify-between py-1">
            <!-- Audio button -->
            <button @click="playerStore.setPlaylist(searchData.sentences, index)"
              class="py-2 px-2 mr-0.5 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300">
              <UiBaseIcon v-if="!(isPlaying && currentSentence && currentSentence.segmentInfo.uuid === sentence.segmentInfo.uuid)" w="w-5" h="h-5" size="24"
                class="" :path="mdiVolumeHigh" />
              <span v-else
                class="animate-spin inline-block w-5 h-5 border-[3px] border-current border-t-transparent text-white rounded-full"
                role="status" aria-label="loading"></span>
            </button>

            <!-- Japanese Sentence -->
            <div class="flex flex-1 relative items-start justify-start my-auto">
              <h3 class=" ml-2 items-start text-xl xxl:text-lg leading-snug">
                <span v-html="sentence.segmentInfo.contentJpHighlight
                  ? sentence.segmentInfo.contentJpHighlight
                  : sentence.segmentInfo.contentJp
                  "></span>
              </h3>

            </div>
            <!-- End Japanese Sentence -->
          </div>
          <!-- Second Row -->
          <div class="items-start flex-1 pt-1 justify-center">
            <!-- Tag Translation -->
            <span
              class="inline-flex items-center gap-x-1 py-1 px-3 rounded-lg text-xs font-medium border border-neutral-700 bg-red-100 text-neutral-600 dark:bg-neutral-700/40 dark:text-neutral-400">{{
                $t('searchpage.main.labels.translation') }}</span>

            <!-- Tag NSFW -->
            <span v-if="sentence.segmentInfo.isNsfw"
              class="bg-gray-100 mb-1 text-gray-800 text-xs xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/30 dark:text-gray-400 border border-gray-700">
              {{ $t('segment.nsfwTag') }}
            </span>

            <div class="font-normal flex-1 text-sm xxl:text-base xxm:text-2xl leading-snug mt-3">
            </div>
          </div>

          <!-- Third Row -->
          <div class="items-start pb-2 flex-1 justify-center">
            <!-- Spanish and English Sentences -->
            <ul class="ml-5 xxm:ml-8 list-disc text-gray-400">
              <li class="my-2 text-sm xxl:text-base xxm:text-2xl" v-for="segment in orderedSegments"
                :key="segment.content">
                <span v-html="sentence.segmentInfo[segment.highlight]
                  ? sentence.segmentInfo[segment.highlight]
                  : sentence.segmentInfo[segment.content]
                  "></span>
                <div v-if="sentence.segmentInfo[segment.mt]" class="nd-tooltip inline-block">
                  <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4"
                    h="h-4" size="19" class="ml-2 nd-tooltip-toggle" />
                  <span
                    class="nd-tooltip-content nd-tooltip-shown:opacity-90 nd-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-[#181818] shadow-sm rounded-md text-white"
                    role="tooltip">
                    {{ $t('searchpage.main.labels.mtTooltip') }}
                  </span>
                </div>
              </li>
            </ul>
            <!-- End Spanish and English Sentences -->
          </div>

          <!-- Fourth Row -->
          <!-- Buttons  -->
          <div class="flex-1 pb-2">
            <SearchSegmentActionsContainer :content="sentence" @open-context-modal="openModal"
              @open-anki-modal="openAnkiModal(sentence)" @concat-sentence="(s, dir) => loadNextSentence(s, dir)" @revert-concat="() => revertActiveConcatenation()" />
          </div>
          <!-- End Buttons  -->

          <!-- Fifth Row -->
          <!-- Media details  -->
          <div class="flex-1 justify-left">
            <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold my-2">
              <button
                @click="filterByMedia(sentence.basicInfo.animeId)"
                class="hover:text-white hover:underline transition-colors cursor-pointer">
                {{ sentence.basicInfo.nameAnimeEn }}
              </button>
              &bull;
              <template v-if="sentence.basicInfo.category === 4">{{ $t('searchpage.main.labels.audiobook') }}</template>
              <template v-else>
                <button
                  @click="filterByMedia(sentence.basicInfo.animeId, sentence.basicInfo.episode)"
                  class="hover:text-white hover:underline transition-colors cursor-pointer">
                  {{ $t('searchpage.main.labels.episode') }} {{ sentence.basicInfo.episode }}
                </button>
              </template>
              &bull; {{ sentence.segmentInfo.startTime.split('.')[0] }}
            </p>
          </div>
        </div>
      </div>
      <!-- End Details -->
    </div>

    <div v-if="isLoading" class="text-center">
      <div
        class="animate-spin inline-block w-6 h-6 my-5 border-[3px] border-current border-t-transparent text-white rounded-full"
        role="status" aria-label="loading">
        <span class="sr-only">Loading...</span>
      </div>
    </div>
  </div>
  <div v-else-if="(isLoading && (searchData?.sentences?.length ?? 0) === 0) || !searchData" class="w-full">
    <div v-for="i in 10" :key="i"
      class="hover:bg-neutral-800/20 mb-11 animate-pulse items-stretch b-2 rounded-lg group transition-all flex flex-col lg:flex-row py-2">
      <!-- Image placeholder  -->
      <div class="h-auto shrink-0 w-auto lg:w-[26em]">
        <div class="h-56 w-full bg-gray-300 dark:bg-neutral-700"></div>
      </div>

      <!-- Content placeholders  -->
      <div class="w-full py-3 sm:py-2 px-4 rounded-e-md flex flex-col justify-between">
        <div class="flex items-center space-x-2 py-1">
          <div class="h-6 bg-gray-300 dark:bg-neutral-700 rounded-full w-5/6"></div>
        </div>

        <!-- Spanish and English translations -->
        <div class="mt-4 space-y-4">
          <div class="h-4 bg-gray-300 dark:bg-neutral-700 rounded-full w-3/4"></div>
          <div class="h-4 bg-gray-300 dark:bg-neutral-700 rounded-full w-3/4"></div>
        </div>

        <!-- Action buttons -->
        <div class="flex space-x-2 mt-4">
          <div class="w-24 h-8 bg-gray-300 dark:bg-neutral-700 rounded-md"></div>
          <div class="w-24 h-8 bg-gray-300 dark:bg-neutral-700 rounded-md"></div>
          <div class="w-24 h-8 bg-gray-300 dark:bg-neutral-700 rounded-md"></div>
          <div class="w-24 h-8 bg-gray-300 dark:bg-neutral-700 rounded-md"></div>
        </div>

        <!-- Media details -->
        <div class="mt-4">
          <div class="h-4 bg-gray-300 dark:bg-neutral-700 rounded-full w-2/4"></div>
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="!isLoading && (searchData?.sentences?.length ?? 0) === 0">
    <section class="w-full py-10">
      <div class="container flex items-center px-4 mx-auto">
        <div class="w-full align-top items-center">
          <div class="flex flex-col items-center max-w-lg mx-auto text-center">
            <img class="mb-6"
              src="/assets/no-results.gif" />
            <h2 class="font-bold text-red-400 text-3xl">{{ $t('segment.noResultsTitle') }}</h2>
            <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchpage.main.labels.noresults') }}</h1>
            <p class="mt-4 text-gray-500 dark:text-gray-400">{{ $t('segment.noResultsMessage') }}</p>
          </div>
        </div>
      </div>
    </section>
    <!-- Get anki cards based on input -->
  </div>
</template>
<style>
.ampliada {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.ampliada img {
  max-width: 90%;
  max-height: 90%;
}

.image-container {
  position: relative;
}
</style>
