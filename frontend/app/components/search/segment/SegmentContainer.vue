<script setup lang="ts">
import { mdiVolumeHigh, mdiTranslate, mdiEyeOff, mdiEye, mdiClose } from '@mdi/js';

import { usePlayerStore } from '~/stores/player';
import { userStore } from '~/stores/auth';
import { useLabsStore } from '~/stores/labs';
import type { SearchResult, SearchResponse } from '~/types/search';

type Props = {
  searchData: SearchResponse | null;
  isLoading: boolean;
  highlightedPosition?: number | null;
  collectionId?: string | null;
  hideContextButton?: boolean;
};

const props = defineProps<Props>();
const emit = defineEmits<{
  'remove-from-collection': [segmentId: number];
}>();

const confirmingRemoveId = ref<number | null>(null);

const confirmRemove = (id: number) => {
  confirmingRemoveId.value = id;
};

const cancelRemove = () => {
  confirmingRemoveId.value = null;
};

const executeRemove = (id: number) => {
  confirmingRemoveId.value = null;
  emit('remove-from-collection', id);
};
const { locale } = useI18n();
const resultList = computed(() => props.searchData?.results ?? []);

const playerStore = usePlayerStore();
const { isPlaying, currentResult } = storeToRefs(playerStore);
const user = userStore();
const { mediaName } = useMediaName();
const { shouldBlur, isRestricted } = useContentRating();
const { englishMode, spanishMode } = useTranslationVisibility();

const selectedResult = ref<SearchResult | null>(null);
const searchNoteResult = ref<SearchResult | null>(null);
const segmentToEdit = ref<SearchResult | null>(null);

// Keyboard navigation
const focusedIndex = ref<number | null>(null);

const scrollFocusedIntoView = () => {
  const result = resultList.value[focusedIndex.value ?? -1];
  if (result) {
    const el = document.getElementById(result.segment.uuid);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }

  const len = resultList.value.length;
  if (len === 0) return;

  switch (event.code) {
    case 'ArrowDown':
      event.preventDefault();
      if (focusedIndex.value === null) {
        focusedIndex.value = 0;
      } else if (focusedIndex.value < len - 1) {
        focusedIndex.value++;
      }
      scrollFocusedIntoView();
      break;

    case 'ArrowUp':
      event.preventDefault();
      if (focusedIndex.value === null) {
        focusedIndex.value = 0;
      } else if (focusedIndex.value > 0) {
        focusedIndex.value--;
      }
      scrollFocusedIntoView();
      break;

    case 'Enter':
      if (focusedIndex.value !== null) {
        event.preventDefault();
        playerStore.setPlaylist(resultList.value, focusedIndex.value);
      }
      break;

    case 'KeyA':
      if (focusedIndex.value !== null) {
        event.preventDefault();
        const result = resultList.value[focusedIndex.value];
        if (result) openAnkiModal(result);
      }
      break;

    case 'KeyC':
      if (focusedIndex.value !== null) {
        event.preventDefault();
        const result = resultList.value[focusedIndex.value];
        if (result) openModal(result);
      }
      break;
  }
};

// Sync focused index when player changes track (via Arrow Left/Right)
watch(currentResult, (result) => {
  if (result) {
    const idx = resultList.value.findIndex((r) => r.segment.uuid === result.segment.uuid);
    if (idx !== -1) {
      focusedIndex.value = idx;
    }
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});
const reportTarget = ref<{
  target:
    | {
        type: 'SEGMENT';
        mediaId: string;
        segmentId: string;
      }
    | {
        type: 'MEDIA';
        mediaId: string;
      };
  segment: SearchResult;
  mediaName?: string;
} | null>(null);

const revealedContent = ref(new Set<string>());

type OrderedSegmentLang = 'textEn' | 'textEs';

const segmentLanguageLabel: Record<OrderedSegmentLang, string> = {
  textEn: 'EN',
  textEs: 'ES',
};

// Order segment according to website language
const orderedSegmentLangs = computed<OrderedSegmentLang[]>(() => {
  if (locale.value === 'en') {
    return ['textEn', 'textEs'];
  }
  return ['textEs', 'textEn'];
});

const segmentLangRows = computed(() =>
  orderedSegmentLangs.value
    .map((lang) => {
      const mode = lang === 'textEn' ? englishMode.value : spanishMode.value;
      return {
        lang,
        mode,
        isSpoiler: mode === 'spoiler',
      };
    })
    .filter((row) => row.mode !== 'hidden'),
);

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
    target:
      type === 'SEGMENT'
        ? { type: 'SEGMENT', mediaId: result.media.publicId, segmentId: result.segment.publicId }
        : { type: 'MEDIA', mediaId: result.media.publicId },
    segment: result,
    mediaName: mediaName(result.media),
  };
};

const onEditSuccess = (updated: SearchResult) => {
  const list = resultList.value;
  const idx = list.findIndex((r) => r.segment.uuid === updated.segment.uuid);
  if (idx !== -1) {
    const item = list[idx];
    if (item) item.segment = { ...updated.segment };
  }
};

const { revertActiveConcatenation, loadNextSegment } = useSegmentConcatenation();

// Filter navigation method
const router = useRouter();
const route = useRoute();

const labsStore = useLabsStore();
const tokensEnabled = computed(() => labsStore.isFeatureEnabled('interactive-tokens'));

const handleTokenSearch = (dictionaryForm: string) => {
  router.push({ path: `/search/${encodeURIComponent(dictionaryForm)}` });
};

const filterByMedia = (mediaId: string, episodeNumber?: number) => {
  const query: Record<string, string | number | string[] | number[] | undefined> = { ...route.query, media: mediaId };

  // Clear episode when selecting only media
  delete query.episode;

  if (episodeNumber !== undefined) {
    query.episode = episodeNumber;
  }

  router.push({ path: route.path, query });
};
</script>
<template>
  <div v-if="(searchData?.results?.length ?? 0) > 0 && searchData">

    <SearchModalContext :sentence="selectedResult" />

    <SearchModalAnkiNotes :sentence="searchNoteResult"
      :onClick="(result: SearchResult, id: number) => ankiStore().addSentenceToAnki(result, id)" />

    <SearchModalSegmentEdit :segment="segmentToEdit" @update:success="onEditSuccess" />

    <SearchModalReport
      :target="reportTarget?.target ?? null"
      :segment="reportTarget?.segment ?? null"
      :mediaName="reportTarget?.mediaName"
    />

    <div v-for="(result, index) in resultList" :key="result.segment.uuid"
      :id="result.segment.uuid"
      class="hover:bg-neutral-800/20 items-stretch b-2 rounded-lg group transition-all flex flex-col min-[650px]:flex-row py-2 relative"
      :class="{
        'bg-neutral-800 hover:bg-neutral-800': currentResult && result.segment.uuid === currentResult.segment.uuid,
        'bg-neutral-800/20': highlightedPosition != null && result.segment.position === highlightedPosition,
        'bg-neutral-700/30 hover:bg-neutral-700/40': focusedIndex === index && !(currentResult && result.segment.uuid === currentResult.segment.uuid),
      }">
      <!-- Image -->
      <div class="shrink-0 w-auto min-[650px]:w-2/5 min-[900px]:w-[25rem] min-[650px]:h-56 min-w-[200px] flex justify-center relative overflow-hidden">
        <img loading="lazy" :src="result.segment.urls.imageUrl"
          :alt="`Screenshot for ${result.media.nameEn || result.media.nameRomaji || result.media.nameJa || 'media segment'}`"
          @click="!(shouldBlur(result.segment.contentRating) && !revealedContent.has(result.segment.uuid)) && zoomImage(result.segment.urls.imageUrl)"
          class="inset-0 aspect-video min-[650px]:aspect-auto min-[650px]:h-full w-full object-cover filter object-center transition-all duration-300 text-transparent mx-auto max-w-2xl min-[650px]:max-w-none"
          :class="shouldBlur(result.segment.contentRating) && !revealedContent.has(result.segment.uuid) ? 'blur-[20px] scale-110' : 'hover:brightness-75 cursor-pointer'"
          @error="($event.target as HTMLImageElement).classList.remove('text-transparent')"
          :key="result.segment.urls.imageUrl" />
        <button
          v-if="shouldBlur(result.segment.contentRating)"
          @click="revealedContent.has(result.segment.uuid) ? revealedContent.delete(result.segment.uuid) : revealedContent.add(result.segment.uuid)"
          class="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/50 hover:bg-black/70 text-white transition-colors z-10 flex items-center gap-1.5 text-xs">
          <UiBaseIcon
            :path="revealedContent.has(result.segment.uuid) ? mdiEye : mdiEyeOff"
            w="w-3.5" h="h-3.5" size="14" />
          <span>{{ revealedContent.has(result.segment.uuid) ? $t('segment.contentRatingHide') : $t('segment.contentRatingShow') }}</span>
        </button>
      </div>
      <!-- End Image -->

      <!-- Remove from collection button -->
      <div v-if="collectionId" class="absolute top-2 right-2 z-10">
        <button
          v-if="confirmingRemoveId !== result.segment.id"
          @click.stop="confirmRemove(result.segment.id)"
          class="opacity-0 group-hover:opacity-100 transition-opacity p-2 aspect-square flex items-center justify-center rounded-md bg-modal-background hover:bg-button-danger-main text-white/70 hover:text-white"
          :title="$t('accountSettings.collections.removeFromCollection')"
        >
          <UiBaseIcon :path="mdiClose" w="w-5" h="h-5" size="20" />
        </button>
        <div v-else class="flex items-center gap-2 bg-modal-background rounded-md px-3 py-2">
          <span class="text-sm text-white/90">{{ $t('accountSettings.collections.confirmRemove') }}</span>
          <button
            @click.stop="executeRemove(result.segment.id)"
            class="px-3 py-1.5 rounded text-sm bg-button-danger-main hover:bg-button-danger-hover text-white font-medium"
          >{{ $t('accountSettings.collections.yes') }}</button>
          <button
            @click.stop="cancelRemove()"
            class="px-3 py-1.5 rounded text-sm bg-neutral-600 hover:bg-neutral-500 text-white font-medium"
          >{{ $t('accountSettings.collections.no') }}</button>
        </div>
      </div>

      <!-- Details -->
      <div class="w-full py-3 sm:py-2 px-4 rounded-e-lg text-white flex flex-col">
        <div class="h-full flex flex-col">
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
              <h3 lang="ja" class="ml-2 text-xl xxl:text-lg leading-snug flex flex-wrap items-center gap-2">
                <SearchSegmentTokenText
                  v-if="tokensEnabled && (result.segment.textJa as any).tokens"
                  :tokens="(result.segment.textJa as any).tokens"
                  :highlight="result.segment.textJa.highlight"
                  class="leading-snug"
                  @token-click="handleTokenSearch"
                />
                <span v-else class="leading-snug" v-html="result.segment.textJa.highlight
                  ? result.segment.textJa.highlight
                  : result.segment.textJa.content
                  "></span>
                <!-- Content Rating Badge -->
                <span v-if="result.segment.contentRating?.toUpperCase() === 'QUESTIONABLE'"
                  class="relative inline-flex group/nsfw items-center justify-center rounded-lg border border-orange-700/50 bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold leading-none text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 whitespace-nowrap align-middle ml-2">
                  <span>{{ $t('segment.nsfwTag') }}</span>
                  <span
                    class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-white shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/nsfw:opacity-100 group-hover/nsfw:visible"
                    role="tooltip">
                    {{ $t('segment.contentRatingDescription.SENSITIVE') }}
                    <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
                  </span>
                </span>
                <span v-else-if="result.segment.contentRating?.toUpperCase() === 'EXPLICIT'"
                  class="relative inline-flex group/nsfw items-center justify-center rounded-lg border border-red-700/50 bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold leading-none text-red-800 dark:bg-red-900/40 dark:text-red-300 whitespace-nowrap align-middle ml-2">
                  <span>{{ $t('segment.nsfwTag') }}</span>
                  <span
                    class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-white shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/nsfw:opacity-100 group-hover/nsfw:visible"
                    role="tooltip">
                    {{ $t('segment.contentRatingDescription.SENSITIVE') }}
                    <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
                  </span>
                </span>
              </h3>

            </div>
            <!-- End Japanese Sentence -->
          </div>
          <!-- Second Row -->
          <div v-if="segmentLangRows.length > 0" class="mt-1 pb-2 flex-1 flex items-center">
            <!-- Spanish and English Sentences -->
            <ul class="m-0 w-full list-none text-gray-400 space-y-1.5">
              <li class="text-base xxl:text-lg xxm:text-2xl flex items-center gap-2 transition-opacity duration-200"
                v-for="row in segmentLangRows"
                :key="row.lang">
                <span
                  class="inline-flex w-9 items-center justify-center rounded-md border border-neutral-600/80 bg-neutral-700/60 px-2.5 py-1.5 text-[11px] font-semibold leading-none tracking-wide transition-all duration-200"
                  :class="row.isSpoiler ? 'text-neutral-300/80' : 'text-neutral-200'">
                  {{ segmentLanguageLabel[row.lang] }}
                </span>
                <div class="group/translation min-w-0 flex-1">
                  <span class="inline rounded-sm px-1 py-1 leading-snug transition-colors duration-200"
                    :class="row.isSpoiler
                      ? 'bg-neutral-700/85 text-transparent group-hover/translation:bg-transparent group-hover/translation:text-gray-400'
                      : 'bg-transparent text-gray-400'"
                    :title="row.isSpoiler ? 'Hover over sentence to preview translation' : undefined"
                    v-html="row.isSpoiler
                      ? result.segment[row.lang].content
                      : (result.segment[row.lang].highlight
                        ? result.segment[row.lang].highlight
                        : result.segment[row.lang].content
                      )"></span>
                  <div v-if="result.segment[row.lang].isMachineTranslated" class="relative inline-flex group/mt-tooltip align-middle ml-2"
                    :class="row.isSpoiler
                      ? 'opacity-40 transition-opacity duration-200 group-hover/translation:opacity-100'
                      : 'opacity-100'">
                    <UiBaseIcon display="inline-block" vertical-align="top" :path="mdiTranslate" fill="#DDDF" w="w-4"
                      h="h-4" size="19" />
                    <span
                      class="pointer-events-none absolute left-1/2 bottom-full mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-1.5 text-sm font-medium text-white shadow-lg opacity-0 invisible transition-opacity duration-150 z-20 group-hover/mt-tooltip:opacity-100 group-hover/mt-tooltip:visible"
                      role="tooltip">
                      {{ $t('searchpage.main.labels.mtTooltip') }}
                      <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800"></span>
                    </span>
                  </div>
                </div>
              </li>
            </ul>
            <!-- End Spanish and English Sentences -->
          </div>

          <div class="mt-auto">
            <!-- Fourth Row -->
            <!-- Buttons  -->
            <div class="pb-2">
              <SearchSegmentActionsContainer :content="result" :hide-context-button="hideContextButton" @open-context-modal="openModal"
                @open-anki-modal="openAnkiModal(result)" @open-edit-modal="openEditModal" @open-report-modal="openReportModal" @concat-sentence="(s, dir) => loadNextSegment(s, dir, props.isLoading)" @revert-concat="() => revertActiveConcatenation()" />
            </div>
            <!-- End Buttons  -->

            <!-- Fifth Row -->
            <!-- Media details  -->
            <div class="justify-left">
              <p class="text-sm xxl:text-base xxm:text-2xl text-white/50 tracking-wide font-semibold mt-0 mb-0">
                <button
                  @click="filterByMedia(result.media.publicId)"
                  class="hover:text-white hover:underline transition-colors cursor-pointer"
                  lang="ja">
                  {{ mediaName(result.media) }}
                </button>
                &bull;
                <button
                  v-if="result.media.airingFormat === 'MOVIE'"
                  @click="filterByMedia(result.media.publicId)"
                  class="hover:text-white hover:underline transition-colors cursor-pointer">
                  {{ $t('searchpage.main.labels.movie') }}
                </button>
                <button
                  v-else
                  @click="filterByMedia(result.media.publicId, result.segment.episode)"
                  class="hover:text-white hover:underline transition-colors cursor-pointer">
                  {{ $t('searchpage.main.labels.episode') }} {{ result.segment.episode }}
                </button>
                &bull; {{ formatMs(result.segment.startTimeMs) }}
              </p>
            </div>
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
      class="hover:bg-neutral-800/20 mb-11 animate-pulse items-stretch b-2 rounded-lg group transition-all flex flex-col min-[650px]:flex-row py-2">
      <!-- Image placeholder  -->
      <div class="shrink-0 w-auto min-[650px]:w-2/5 min-[900px]:w-[26em]">
        <div class="aspect-video min-[650px]:aspect-auto min-[650px]:h-56 w-full max-w-2xl min-[650px]:max-w-none mx-auto bg-gray-300 dark:bg-neutral-700"></div>
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
              src="/assets/no-results.gif" alt="No results illustration" />
            <h2 class="font-bold text-red-400 text-3xl">{{ $t('segment.noResultsTitle') }}</h2>
            <h1 class="mt-2 text-2xl font-semibold text-gray-800 dark:text-white md:text-3xl">{{ $t('searchpage.main.labels.noresults') }}</h1>
            <p class="mt-4 text-gray-500 dark:text-gray-400">
              <i18n-t keypath="segment.noResultsMessage" tag="span">
                <template #link>
                  <a href="https://www.immersionkit.com" target="_blank" rel="noopener noreferrer" class="text-red-400 hover:text-red-300 underline underline-offset-4">immersionkit.com</a>
                </template>
              </i18n-t>
            </p>
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
