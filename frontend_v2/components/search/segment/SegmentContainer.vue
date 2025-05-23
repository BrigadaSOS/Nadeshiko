<script setup lang="ts">

import { mdiTranslate, mdiVolumeHigh, mdiChevronRight, mdiClose, mdiChevronLeft, mdiArrowExpandHorizontal } from '@mdi/js'

type Props = {
  searchData: any;
  isLoading: boolean;
  currentSentenceIndex: any;
};

// const props = defineProps(['searchData', 'ankiNotesQuery', 'isLoading']);
const props = defineProps<Props>();
let locale = ref('en');

let selectedSentence = ref(null);
let searchNoteSentence: Ref<Sentence | null> = ref(null);

// Order segment according to website language
const orderedSegments = computed(() => {
  const segments = [
    {
      content: 'content_es',
      highlight: 'content_es_highlight',
      mt: 'content_es_mt'
    },
    {
      content: 'content_en',
      highlight: 'content_en_highlight',
      mt: 'content_en_mt'
    }
  ];

  if (locale.value === 'en') {
    return [segments[1], segments[0]];
  }
  return segments;
});

// @ts-ignore
const openModal = (content) => {
  selectedSentence.value = content;
};

const openAnkiModal = (sentence: Sentence) => {
  searchNoteSentence.value = sentence;
};

const apiSearch = useApiSearch();

interface IORiginalContent {
  content_jp: string;
  content_en: string;
  content_es: string;
  content_jp_highlight: string;
  content_en_highlight: string;
  content_es_highlight: string;
}

interface IConcatenation {
  sentence: Sentence | null;
  originalContent: IORiginalContent | null;
};

let activeConcatenation: IConcatenation = {
  sentence: null,
  originalContent: null,
};

const revertActiveConcatenation = () => {
  if (activeConcatenation.sentence && activeConcatenation.originalContent) {

    // We free the current url/blob
    if (activeConcatenation.sentence.media_info.blob_audio_url) {
      window.URL.revokeObjectURL(activeConcatenation.sentence.media_info.blob_audio_url);
    }

    // Revert the sentence info to the original
    activeConcatenation.sentence.media_info.blob_audio_url = null;
    activeConcatenation.sentence.media_info.blob_audio = null;

    activeConcatenation.sentence.segment_info = {
      ...activeConcatenation.sentence.segment_info,
      content_jp: activeConcatenation.originalContent.content_jp,
      content_en: activeConcatenation.originalContent.content_en,
      content_es: activeConcatenation.originalContent.content_es,
      content_jp_highlight: activeConcatenation.originalContent.content_jp_highlight,
      content_en_highlight: activeConcatenation.originalContent.content_en_highlight,
      content_es_highlight: activeConcatenation.originalContent.content_es_highlight,
    };

    activeConcatenation = { sentence: null, originalContent: null };
  }
};

const isConcatenated = (sentence: Sentence) => {
  return activeConcatenation.sentence === sentence;
};

/// This function is called when the user wants to expand the current sentence
const loadNextSentence = async (sentence: Sentence, direction: 'forward' | 'backward' | 'both') => {

  if (props.isLoading) {
    return;
  }

  // Revertir cualquier concatenación activa antes de proceder
  revertActiveConcatenation();

  document.querySelectorAll("#concatenate-button").forEach( e => (e as HTMLButtonElement).disabled = true );

  const audioUrls: string[] = [sentence.media_info.path_audio];

  try {
    const response = await apiSearch.getContextSentence({
      media_id: sentence.basic_info.id_anime,
      season: sentence.basic_info.season,
      episode: sentence.basic_info.episode,
      segment_position: sentence.segment_info.position,
      limit: 1, // Traer tres oraciones: anterior, actual y siguiente
    });

    if (response && response.sentences.length > 0) {
      const previousSentence = response.sentences[0];
      const nextSentence = response.sentences[2];

      // Guardar el contenido original antes de concatenar
      activeConcatenation = {
        sentence,
        originalContent: {
          content_jp: sentence.segment_info.content_jp,
          content_en: sentence.segment_info.content_en,
          content_es: sentence.segment_info.content_es,
          content_jp_highlight: sentence.segment_info.content_jp_highlight,
          content_en_highlight: sentence.segment_info.content_en_highlight,
          content_es_highlight: sentence.segment_info.content_es_highlight,
        },
      };

      let concatenatedAudio;

      // Concatenar según la dirección especificada
      if (direction === 'forward') {
        audioUrls.push(nextSentence.media_info.path_audio);
        concatenatedAudio = await concatenateAudios(audioUrls);

        sentence.segment_info = {
          ...sentence.segment_info,
          content_jp: `${sentence.segment_info.content_jp} <span class="text-cyan-200">${nextSentence.segment_info.content_jp}</span>`,
          content_en: `${sentence.segment_info.content_en} <span class="text-cyan-200">${nextSentence.segment_info.content_en}</span>`,
          content_es: `${sentence.segment_info.content_es} <span class="text-cyan-200">${nextSentence.segment_info.content_es}</span>`,
          content_jp_highlight: `${sentence.segment_info.content_jp_highlight || sentence.segment_info.content_jp} <span class="text-cyan-200">${nextSentence.segment_info.content_jp_highlight || nextSentence.segment_info.content_jp}</span>`,
          content_en_highlight: `${sentence.segment_info.content_en_highlight || sentence.segment_info.content_en} <span class="text-cyan-200">${nextSentence.segment_info.content_en_highlight || nextSentence.segment_info.content_en}</span>`,
          content_es_highlight: `${sentence.segment_info.content_es_highlight || sentence.segment_info.content_es} <span class="text-cyan-200">${nextSentence.segment_info.content_es_highlight || nextSentence.segment_info.content_es}</span>`,
        };
      } else if (direction === 'backward') {
        audioUrls.unshift(previousSentence.media_info.path_audio);
        concatenatedAudio = await concatenateAudios(audioUrls);

        sentence.segment_info = {
          ...sentence.segment_info,
          content_jp: `<span class="text-cyan-200">${previousSentence.segment_info.content_jp}</span> ${sentence.segment_info.content_jp}`,
          content_en: `<span class="text-cyan-200">${previousSentence.segment_info.content_en}</span> ${sentence.segment_info.content_en}`,
          content_es: `<span class="text-cyan-200">${previousSentence.segment_info.content_es}</span> ${sentence.segment_info.content_es}`,
          content_jp_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_jp_highlight || previousSentence.segment_info.content_jp}</span> ${sentence.segment_info.content_jp_highlight || sentence.segment_info.content_jp}`,
          content_en_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_en_highlight || previousSentence.segment_info.content_en}</span> ${sentence.segment_info.content_en_highlight || sentence.segment_info.content_en}`,
          content_es_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_es_highlight || previousSentence.segment_info.content_es}</span> ${sentence.segment_info.content_es_highlight || sentence.segment_info.content_es}`,
        };
      } else if (direction === 'both') {
        // Expandir en ambas direcciones
        audioUrls.unshift(previousSentence.media_info.path_audio);
        audioUrls.push(nextSentence.media_info.path_audio);

        concatenatedAudio = await concatenateAudios(audioUrls);
        sentence.segment_info = {
          ...sentence.segment_info,
          content_jp: `<span class="text-cyan-200">${previousSentence.segment_info.content_jp}</span> ${sentence.segment_info.content_jp} <span class="text-cyan-200">${nextSentence.segment_info.content_jp}</span>`,
          content_en: `<span class="text-cyan-200">${previousSentence.segment_info.content_en}</span> ${sentence.segment_info.content_en} <span class="text-cyan-200">${nextSentence.segment_info.content_en}</span>`,
          content_es: `<span class="text-cyan-200">${previousSentence.segment_info.content_es}</span> ${sentence.segment_info.content_es} <span class="text-cyan-200">${nextSentence.segment_info.content_es}</span>`,
          content_jp_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_jp}</span>  ${sentence.segment_info.content_jp_highlight || sentence.segment_info.content_jp} <span class="text-cyan-200">${nextSentence.segment_info.content_jp_highlight || nextSentence.segment_info.content_jp}</span>`,
          content_en_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_en}</span> ${sentence.segment_info.content_en_highlight || sentence.segment_info.content_en} <span class="text-cyan-200">${nextSentence.segment_info.content_en_highlight || nextSentence.segment_info.content_en}</span>`,
          content_es_highlight: `<span class="text-cyan-200">${previousSentence.segment_info.content_es}</span> ${sentence.segment_info.content_es_highlight || sentence.segment_info.content_es} <span class="text-cyan-200">${nextSentence.segment_info.content_es_highlight || nextSentence.segment_info.content_es}</span>`,
        };
      }

      // @ts-ignore
      sentence.media_info.blob_audio_url = concatenatedAudio.blob_url;
      // @ts-ignore
      sentence.media_info.blob_audio = concatenatedAudio.blob;
    }
  } catch (error) {
     // Reset active concatenation
    activeConcatenation = { sentence: null, originalContent: null };
    console.error('Error fetching context sentences:', error);
  } finally {
    document.querySelectorAll("#concatenate-button").forEach( e => (e as HTMLButtonElement).disabled = false );
  }
};


</script>
<template>
  <div v-if="searchData?.sentences?.length > 0 && searchData">

    <SearchModalContext :sentence="selectedSentence" />

    <SearchModalAnkiNotes :sentence="searchNoteSentence"
      :onClick="(sentence: Sentence, id: number) => ankiStore().addSentenceToAnki(sentence, id)" />

    <div v-for="(sentence, index) in searchData.sentences" :key="sentence.segment_info.position"
      :id="sentence.segment_info.position"
      class="hover:bg-neutral-800/20 items-stretch b-2 rounded-lg group transition-all  flex flex-col lg:flex-row py-2"
      :class="{ 'bg-neutral-800 hover:bg-neutral-800': sentence.segment_info.position === props.currentSentenceIndex }">
      <!-- Image -->
      <div class="h-auto shrink-0 w-auto lg:w-[25rem] min-w-[200px] min-h-[140px] flex justify-center">
        <img loading="lazy" :src="sentence.media_info.path_image + '?width=960&height=540'"
          @click="zoomImage(sentence.media_info.path_image)"
          class="inset-0 h-56 w-full object-cover filter hover:brightness-75 cursor-pointer object-center"
          :key="sentence.media_info.path_image" />
      </div>
      <!-- End Image -->

      <!-- Details -->
      <div class="w-full py-3 sm:py-2 px-4 rounded-e-lg text-white flex flex-col justify-between">
        <div>
          <!-- First Row -->
          <div class="flex items-center justify-between py-1">
            <!-- Audio button -->
            <button
              @click="playAudio(sentence.media_info.blob_audio_url ? sentence.media_info.blob_audio_url : sentence.media_info.path_audio, sentence.segment_info.uuid)"
              class="py-2 px-2 mr-0.5 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300">
              <UiBaseIcon v-if="!isAudioPlaying[sentence.segment_info.uuid]" w="w-5" h="h-5" size="24"
                class="" :path="mdiVolumeHigh" />
              <span v-else="isAudioPlaying"
                class="animate-spin inline-block w-5 h-5 border-[3px] border-current border-t-transparent text-white rounded-full"
                role="status" aria-label="loading"></span>
            </button>

            <!-- Japanese Sentence -->
            <div class="flex flex-1 relative items-start justify-start my-auto">
              <h3 class=" ml-2 items-start text-xl xxl:text-lg leading-snug">
                <span v-html="sentence.segment_info.content_jp_highlight
                  ? sentence.segment_info.content_jp_highlight
                  : sentence.segment_info.content_jp
                  "></span>
              </h3>

              <div class="hidden sm:flex ml-auto">
                <UiButtonPrimaryAction class="ml-4 p-0.5 lg:hidden group-hover:flex transition duration-300"
                  id="concatenate-button"
                  @click="loadNextSentence(sentence, 'backward')" v-if="!isConcatenated(sentence)"
                  :title="$t('segment.expandLeft')">
                  <UiBaseIcon :path="mdiChevronLeft" />
                </UiButtonPrimaryAction>

                <UiButtonPrimaryAction class="ml-2 p-0.5 lg:hidden group-hover:flex transition duration-300"
                  id="concatenate-button"
                  @click="loadNextSentence(sentence, 'both')" v-if="!isConcatenated(sentence)"
                  :title="$t('segment.expandBoth')">
                  <UiBaseIcon :path="mdiArrowExpandHorizontal" />
                </UiButtonPrimaryAction>

                <UiButtonPrimaryAction class="ml-2 p-0.5 lg:hidden group-hover:flex transition duration-300"
                  id="concatenate-button"
                  @click="loadNextSentence(sentence, 'forward')" v-if="!isConcatenated(sentence)"
                  :title="$t('segment.expandRight')">
                  <UiBaseIcon :path="mdiChevronRight" />
                </UiButtonPrimaryAction>

                <UiButtonPrimaryAction class="ml-4 p-0.5 lg:hidden group-hover:flex transition duration-300"
                  @click="revertActiveConcatenation" v-if="isConcatenated(sentence)"
                  :title="$t('segment.revert')">
                  <UiBaseIcon :path="mdiClose" />
                </UiButtonPrimaryAction>
              </div>
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
            <span v-if="sentence.segment_info.is_nsfw"
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
                <span v-html="sentence.segment_info[segment.highlight]
                  ? sentence.segment_info[segment.highlight]
                  : sentence.segment_info[segment.content]
                  "></span>
                <div v-if="sentence.segment_info[segment.mt]" class="hs-tooltip inline-block">
                  <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4"
                    h="h-4" size="19" class="ml-2 hs-tooltip-toggle" />
                  <span
                    class="hs-tooltip-content hs-tooltip-shown:opacity-90 hs-tooltip-shown:visible opacity-0 transition-opacity inline-block absolute invisible z-10 py-1 px-2 bg-[#181818] shadow-sm rounded-md text-white"
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
              @open-anki-modal="openAnkiModal(sentence)" />
          </div>
          <!-- End Buttons  -->

          <!-- Fifth Row -->
          <!-- Media details  -->
          <div class="flex-1 justify-left">
            <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold my-2">
              {{ sentence.basic_info.name_anime_en }} &bull;
              <template v-if="sentence.basic_info.season === 0">{{ $t('searchpage.main.labels.movie')
                }}</template>
              <template v-else>
                {{ $t('searchpage.main.labels.season') }} {{ sentence.basic_info.season }},
                {{ $t('searchpage.main.labels.episode') }} {{ sentence.basic_info.episode }}
              </template>
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
  <div v-else-if="isLoading && !searchData?.sentences?.length || !searchData" class="w-full">
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
  <div v-else-if="!isLoading && searchData?.sentences?.length === 0">
    <section class="w-full py-10">
      <div class="container flex items-center px-4 mx-auto">
        <div class="w-full align-top items-center">
          <div class="flex flex-col items-center max-w-lg mx-auto text-center">
            <img class="mb-6"
              src="https://animeforums.net/uploads/monthly_2022_03/haruhi-suzumiya-kyon-computer-haruhi-suzumiya.gif.be78c7de58e641e3701a97a85d01a059.gif" />
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
