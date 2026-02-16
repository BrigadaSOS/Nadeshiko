<script setup lang="ts">
import { mdiVolumeHigh, mdiTranslate, mdiEyeOff, mdiEye } from '@mdi/js';

import { usePlayerStore } from '~/stores/player';
import { userStore } from '~/stores/auth';
import type { SearchResult, SearchResponse } from '~/stores/search';

type Props = {
  searchData: SearchResponse | null;
  isLoading: boolean;
  highlightedPosition?: number | null;
};

const props = defineProps<Props>();
const { locale } = useI18n();
const resultList = computed(() => props.searchData?.results ?? []);

const playerStore = usePlayerStore();
const { isPlaying, currentResult } = storeToRefs(playerStore);
const user = userStore();
const { mediaName } = useMediaName();

const selectedResult = ref<SearchResult | null>(null);
const searchNoteResult = ref<SearchResult | null>(null);
const segmentToEdit = ref<SearchResult | null>(null);
const reportTarget = ref<{
  targetType: 'SEGMENT' | 'MEDIA';
  targetMediaId: number;
  targetSegmentUuid?: string;
  mediaName?: string;
} | null>(null);

const revealedNsfw = ref(new Set<string>());

type OrderedSegmentLang = 'textEn' | 'textEs';

// Order segment according to website language
const orderedSegmentLangs = computed<OrderedSegmentLang[]>(() => {
  if (locale.value === 'en') {
    return ['textEn', 'textEs'];
  }
  return ['textEs', 'textEn'];
});

const openModal = (content: SearchResult) => {
  selectedResult.value = content;
};

const openAnkiModal = (result: SearchResult) => {
  searchNoteResult.value = result;
};

const openEditModal = (result: SearchResult) => {
  segmentToEdit.value = result;
};

const openReportModal = (result: SearchResult, type: 'SEGMENT' | 'MEDIA' = 'SEGMENT') => {
  reportTarget.value = {
    targetType: type,
    targetMediaId: result.media.mediaId,
    targetSegmentUuid: type === 'SEGMENT' ? result.segment.uuid : undefined,
    mediaName: mediaName(result.media),
  };
};

const onEditSuccess = (updated: SearchResult) => {
  const list = resultList.value;
  const idx = list.findIndex((r) => r.segment.uuid === updated.segment.uuid);
  if (idx !== -1) {
    list[idx].segment = { ...updated.segment };
  }
};

const apiSearch = useApiSearch();

interface IOriginalContent {
  textJa: { content: string; highlight?: string };
  textEn: { content?: string; highlight?: string; isMachineTranslated: boolean };
  textEs: { content?: string; highlight?: string; isMachineTranslated: boolean };
}

interface IConcatenation {
  result: SearchResult | null;
  originalContent: IOriginalContent | null;
}

let activeConcatenation: IConcatenation = {
  result: null,
  originalContent: null,
};

const revertActiveConcatenation = () => {
  if (activeConcatenation.result && activeConcatenation.originalContent) {
    // We free the current url/blob
    if (activeConcatenation.result.urls.blobAudioUrl) {
      window.URL.revokeObjectURL(activeConcatenation.result.urls.blobAudioUrl);
    }

    // Revert the result info to the original
    activeConcatenation.result.urls.blobAudioUrl = null;
    activeConcatenation.result.urls.blobAudio = null;

    activeConcatenation.result.segment = {
      ...activeConcatenation.result.segment,
      textJa: { ...activeConcatenation.originalContent.textJa },
      textEn: { ...activeConcatenation.originalContent.textEn },
      textEs: { ...activeConcatenation.originalContent.textEs },
    };

    activeConcatenation = { result: null, originalContent: null };
  }
};

// Filter navigation method
const router = useRouter();
const route = useRoute();

const filterByMedia = (mediaId: number, episodeNumber?: number) => {
  const query: Record<string, string | number | string[] | number[] | undefined> = { ...route.query, media: mediaId };

  // Clear episode when selecting only media
  delete query.episode;

  if (episodeNumber !== undefined) {
    query.episode = episodeNumber;
  }

  router.push({ path: route.path, query });
};

const _isConcatenated = (result: SearchResult) => {
  return activeConcatenation.result === result;
};

/// This function is called when the user wants to expand the current segment
const loadNextSegment = async (result: SearchResult, direction: 'forward' | 'backward' | 'both') => {
  if (props.isLoading) {
    return;
  }

  // Revert any active concatenation before proceeding
  revertActiveConcatenation();

  document.querySelectorAll('#concatenate-button').forEach((e) => {
    (e as HTMLButtonElement).disabled = true;
  });

  const audioUrls: string[] = [result.urls.audioUrl];

  try {
    const response = await apiSearch.getSegmentContext({
      uuid: result.segment.uuid,
      limit: 1,
    });

    if (response && response.segments.length > 0) {
      const previousSegment = response.segments[0];
      const nextSegment = response.segments[2];

      // Save the original content before concatenating
      activeConcatenation = {
        result,
        originalContent: {
          textJa: { ...result.segment.textJa },
          textEn: { ...result.segment.textEn },
          textEs: { ...result.segment.textEs },
        },
      };

      let concatenatedAudio: Awaited<ReturnType<typeof concatenateAudios>> | null = null;

      // Concatenate according to the specified direction
      if (direction === 'forward') {
        if (!nextSegment) {
          return;
        }
        audioUrls.push(nextSegment.urls.audioUrl);
        concatenatedAudio = await concatenateAudios(audioUrls);

        result.segment = {
          ...result.segment,
          textJa: {
            content: `${result.segment.textJa.content} <span class="text-cyan-200">${nextSegment.segment.textJa.content}</span>`,
            highlight: `${result.segment.textJa.highlight || result.segment.textJa.content} <span class="text-cyan-200">${nextSegment.segment.textJa.highlight || nextSegment.segment.textJa.content}</span>`,
          },
          textEn: {
            ...result.segment.textEn,
            content: `${result.segment.textEn.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEn.content || ''}</span>`,
            highlight: `${result.segment.textEn.highlight || result.segment.textEn.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEn.highlight || nextSegment.segment.textEn.content || ''}</span>`,
          },
          textEs: {
            ...result.segment.textEs,
            content: `${result.segment.textEs.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEs.content || ''}</span>`,
            highlight: `${result.segment.textEs.highlight || result.segment.textEs.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEs.highlight || nextSegment.segment.textEs.content || ''}</span>`,
          },
        };
      } else if (direction === 'backward') {
        if (!previousSegment) {
          return;
        }
        audioUrls.unshift(previousSegment.urls.audioUrl);
        concatenatedAudio = await concatenateAudios(audioUrls);

        result.segment = {
          ...result.segment,
          textJa: {
            content: `<span class="text-cyan-200">${previousSegment.segment.textJa.content}</span> ${result.segment.textJa.content}`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textJa.highlight || previousSegment.segment.textJa.content}</span> ${result.segment.textJa.highlight || result.segment.textJa.content}`,
          },
          textEn: {
            ...result.segment.textEn,
            content: `<span class="text-cyan-200">${previousSegment.segment.textEn.content || ''}</span> ${result.segment.textEn.content || ''}`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textEn.highlight || previousSegment.segment.textEn.content || ''}</span> ${result.segment.textEn.highlight || result.segment.textEn.content || ''}`,
          },
          textEs: {
            ...result.segment.textEs,
            content: `<span class="text-cyan-200">${previousSegment.segment.textEs.content || ''}</span> ${result.segment.textEs.content || ''}`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textEs.highlight || previousSegment.segment.textEs.content || ''}</span> ${result.segment.textEs.highlight || result.segment.textEs.content || ''}`,
          },
        };
      } else if (direction === 'both') {
        if (!previousSegment || !nextSegment) {
          return;
        }
        // Expand in both directions
        audioUrls.unshift(previousSegment.urls.audioUrl);
        audioUrls.push(nextSegment.urls.audioUrl);

        concatenatedAudio = await concatenateAudios(audioUrls);
        result.segment = {
          ...result.segment,
          textJa: {
            content: `<span class="text-cyan-200">${previousSegment.segment.textJa.content}</span> ${result.segment.textJa.content} <span class="text-cyan-200">${nextSegment.segment.textJa.content}</span>`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textJa.content}</span> ${result.segment.textJa.highlight || result.segment.textJa.content} <span class="text-cyan-200">${nextSegment.segment.textJa.highlight || nextSegment.segment.textJa.content}</span>`,
          },
          textEn: {
            ...result.segment.textEn,
            content: `<span class="text-cyan-200">${previousSegment.segment.textEn.content || ''}</span> ${result.segment.textEn.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEn.content || ''}</span>`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textEn.content || ''}</span> ${result.segment.textEn.highlight || result.segment.textEn.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEn.highlight || nextSegment.segment.textEn.content || ''}</span>`,
          },
          textEs: {
            ...result.segment.textEs,
            content: `<span class="text-cyan-200">${previousSegment.segment.textEs.content || ''}</span> ${result.segment.textEs.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEs.content || ''}</span>`,
            highlight: `<span class="text-cyan-200">${previousSegment.segment.textEs.content || ''}</span> ${result.segment.textEs.highlight || result.segment.textEs.content || ''} <span class="text-cyan-200">${nextSegment.segment.textEs.highlight || nextSegment.segment.textEs.content || ''}</span>`,
          },
        };
      }

      if (concatenatedAudio) {
        result.urls.blobAudioUrl = concatenatedAudio.blob_url;
        result.urls.blobAudio = concatenatedAudio.blob;
      }
    }
  } catch (error) {
    // Reset active concatenation
    activeConcatenation = { result: null, originalContent: null };
    console.error('Error fetching context segments:', error);
  } finally {
    document.querySelectorAll('#concatenate-button').forEach((e) => {
      (e as HTMLButtonElement).disabled = false;
    });
  }
};
</script>
<template>
  <div v-if="(searchData?.results?.length ?? 0) > 0 && searchData">

    <SearchModalContext :sentence="selectedResult" />

    <SearchModalAnkiNotes :sentence="searchNoteResult"
      :onClick="(result: SearchResult, id: number) => ankiStore().addSentenceToAnki(result, id)" />

    <SearchModalSegmentEdit :segment="segmentToEdit" @update:success="onEditSuccess" />

    <SearchModalReport
      :targetType="reportTarget?.targetType ?? 'SEGMENT'"
      :targetMediaId="reportTarget?.targetMediaId ?? null"
      :targetSegmentUuid="reportTarget?.targetSegmentUuid"
      :mediaName="reportTarget?.mediaName"
    />

    <div v-for="(result, index) in resultList" :key="result.segment.uuid"
      :id="result.segment.uuid"
      class="hover:bg-neutral-800/20 items-stretch b-2 rounded-lg group transition-all  flex flex-col lg:flex-row py-2"
      :class="{
        'bg-neutral-800 hover:bg-neutral-800': currentResult && result.segment.uuid === currentResult.segment.uuid,
        'bg-neutral-800/20': highlightedPosition != null && result.segment.position === highlightedPosition,
      }">
      <!-- Image -->
      <div class="h-56 shrink-0 w-auto lg:w-[25rem] min-w-[200px] flex justify-center relative overflow-hidden">
        <img loading="lazy" :src="result.urls.imageUrl"
          @click="!(result.segment.isNsfw && !revealedNsfw.has(result.segment.uuid)) && zoomImage(result.urls.imageUrl)"
          class="inset-0 h-full w-full object-cover filter object-center transition-all duration-300"
          :class="result.segment.isNsfw && !revealedNsfw.has(result.segment.uuid) ? 'blur-md' : 'hover:brightness-75 cursor-pointer'"
          :key="result.urls.imageUrl" />
        <button
          v-if="result.segment.isNsfw"
          @click="revealedNsfw.has(result.segment.uuid) ? revealedNsfw.delete(result.segment.uuid) : revealedNsfw.add(result.segment.uuid)"
          class="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white transition-colors z-10 flex items-center gap-1.5 text-xs">
          <UiBaseIcon
            :path="revealedNsfw.has(result.segment.uuid) ? mdiEye : mdiEyeOff"
            w="w-3.5" h="h-3.5" size="14" />
          <span>{{ revealedNsfw.has(result.segment.uuid) ? $t('segment.nsfwHide') : $t('segment.nsfwShow') }}</span>
        </button>
      </div>
      <!-- End Image -->

      <!-- Details -->
      <div class="w-full py-3 sm:py-2 px-4 rounded-e-lg text-white flex flex-col justify-between">
        <div>
          <!-- First Row -->
          <div class="flex items-center justify-between py-1">
            <!-- Audio button -->
            <button @click="playerStore.setPlaylist(resultList, index)"
              class="py-2 px-2 mr-0.5 inline-flex items-center gap-x-2 text-sm font-semibold rounded-lg border border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-50 disabled:pointer-events-none dark:bg-white/10 dark:hover:bg-white/30 dark:text-neutral-400 dark:hover:text-neutral-300">
              <UiBaseIcon v-if="!(isPlaying && currentResult && currentResult.segment.uuid === result.segment.uuid)" w="w-5" h="h-5" size="24"
                class="" :path="mdiVolumeHigh" />
              <span v-else
                class="animate-spin inline-block w-5 h-5 border-[3px] border-current border-t-transparent text-white rounded-full"
                role="status" aria-label="loading"></span>
            </button>

            <!-- Japanese Sentence -->
            <div class="flex flex-1 relative items-start justify-start my-auto">
              <h3 class=" ml-2 items-start text-xl xxl:text-lg leading-snug">
                <span v-html="result.segment.textJa.highlight
                  ? result.segment.textJa.highlight
                  : result.segment.textJa.content
                  "></span>
              </h3>

            </div>
            <!-- End Japanese Sentence -->
          </div>
          <!-- Second Row -->
          <div class="items-start flex-1 pt-1 justify-center flex flex-wrap gap-2">
            <!-- Tag Translation -->
            <span
              class="inline-flex items-center gap-x-1 py-1 px-3 rounded-lg text-xs font-medium border border-neutral-700 bg-red-100 text-neutral-600 dark:bg-neutral-700/40 dark:text-neutral-400">{{
                $t('searchpage.main.labels.translation') }}</span>

            <!-- Tag NSFW -->
            <span v-if="result.segment.isNsfw"
              class="inline-flex items-center gap-x-1 py-1 px-3 rounded-lg text-xs font-medium border border-red-700/50 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {{ $t('segment.nsfwTag') }}
            </span>

            <div class="font-normal flex-1 text-sm xxl:text-base xxm:text-2xl leading-snug mt-3">
            </div>
          </div>

          <!-- Third Row -->
          <div class="items-start pb-2 flex-1 justify-center">
            <!-- Spanish and English Sentences -->
            <ul class="ml-5 xxm:ml-8 list-disc text-gray-400">
              <li class="my-2 text-sm xxl:text-base xxm:text-2xl" v-for="lang in orderedSegmentLangs"
                :key="lang">
                <span v-html="result.segment[lang].highlight
                  ? result.segment[lang].highlight
                  : result.segment[lang].content
                  "></span>
                <div v-if="result.segment[lang].isMachineTranslated" class="nd-tooltip inline-block">
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
            <SearchSegmentActionsContainer :content="result" @open-context-modal="openModal"
              @open-anki-modal="openAnkiModal(result)" @open-edit-modal="openEditModal" @open-report-modal="openReportModal" @concat-sentence="(s, dir) => loadNextSegment(s, dir)" @revert-concat="() => revertActiveConcatenation()" />
          </div>
          <!-- End Buttons  -->

          <!-- Fifth Row -->
          <!-- Media details  -->
          <div class="flex-1 justify-left">
            <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold my-2">
              <button
                @click="filterByMedia(result.media.mediaId)"
                class="hover:text-white hover:underline transition-colors cursor-pointer">
                {{ mediaName(result.media) }}
              </button>
              &bull;
              <button
                @click="filterByMedia(result.media.mediaId, result.segment.episodeNumber)"
                class="hover:text-white hover:underline transition-colors cursor-pointer">
                {{ $t('searchpage.main.labels.episode') }} {{ result.segment.episodeNumber }}
              </button>
              &bull; {{ result.segment.startTime.split('.')[0] }}
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
  <div v-else-if="(isLoading && (searchData?.results?.length ?? 0) === 0) || !searchData" class="w-full">
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
  <div v-else-if="!isLoading && (searchData?.results?.length ?? 0) === 0">
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
