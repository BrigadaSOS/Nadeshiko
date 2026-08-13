<script setup lang="ts">
import type { SearchResponse, SearchResult } from '~/types/search';
import { resolveContextResponse } from '~/utils/resolvers';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '~/stores/player';
import { handleApiError } from '~/utils/apiError';
const { t } = useI18n();
const playerStore = usePlayerStore();
const { showPlayer } = storeToRefs(playerStore);
const { mediaName } = useMediaName();
const props = defineProps<{ sentence: SearchResult | null }>();
const emit = defineEmits<{ close: [] }>();

const sdk = useNadeshikoSdk();
const { contentRating } = useContentRating();

const isLoading = ref(false);
const contextData = ref<SearchResponse | null>(null);
const highlightedPosition = ref<number | null>(null);
// The modal body renders nothing at all when `contextData` is null, so without this
// a failed fetch is indistinguishable from a segment that simply has no context.
const loadFailed = ref(false);

const getContextSentence = async () => {
  const sentence = props.sentence;
  if (!sentence || isLoading.value) return;
  isLoading.value = true;
  contextData.value = null;
  loadFailed.value = false;

  try {
    const data = await sdk.getSegmentContext({
      segmentPublicId: sentence.segment.publicId,
      take: 15,
      contentRating: contentRating.value,
      // Without this the API omits the `includes.media` block, every card
      // resolves to an empty media, and the header reads "Context - ".
      include: ['media'],
    });
    const response = resolveContextResponse(data);
    contextData.value = { results: response.segments };
    highlightedPosition.value = sentence.segment.position;
    await nextTick();

    const match = response?.segments?.find((s: SearchResult) => s.segment.position === sentence.segment.position);
    if (match) {
      scrollToElement(match.segment.publicId);
    }
  } catch (error) {
    // Surfaced inline below rather than as a toast: the modal is already the focus.
    handleApiError('search:segment-context-failed', error, {
      toastKey: false,
      context: { 'segment.publicId': sentence.segment.publicId },
    });
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => props.sentence,
  (newVal) => {
    if (newVal) {
      getContextSentence();
    }
  },
);

// The segment that opened the modal is also on the page behind it, and both
// cards carry the segment's publicId as their DOM id. The modal teleports to
// the end of <body>, so `getElementById` returns the page's copy and scrolls
// the background instead of the modal. Scope the lookup to the modal body.
const scrollBody = ref<HTMLElement | null>(null);

const scrollToElement = (id: string) => {
  nextTick(() => {
    const el = scrollBody.value?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  });
};
</script>

<template>
  <CommonBaseModal data-testid="context-modal" :open="!!sentence" labelledby="nd-context-modal-title"
    panel-class="w-full max-w-7xl mx-auto h-full flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border"
    :panel-style="{ maxHeight: showPlayer ? '85vh' : '95vh', marginBottom: showPlayer ? '5rem' : '0' }"
    @close="emit('close')">
    <div class="nd-modal-header">
      <h3 id="nd-context-modal-title" data-testid="context-modal-title" class="font-bold text-gray-800 dark:text-white">
        {{ t('searchpage.modalcontext.labels.context') }} - {{
          contextData?.results?.[0]?.media ? mediaName(contextData.results[0].media) : '' }}
      </h3>
      <button type="button" data-testid="context-modal-close"
        class="inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
        @click="emit('close')">
        <span class="sr-only">{{ t('modalContext.closeSrOnly') }}</span>
        <svg class="w-3.5 h-3.5" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0.258 1.007a.75.75 0 011.06 0L3.612 3.653 6.258 1.007a.75.75 0 111.06 1.06L4.672 4.36l2.647 2.647a.75.75 0 11-1.06 1.06L3.612 5.42l-2.647 2.646a.75.75 0 11-1.06-1.06L2.553 4.36.258 2.067a.75.75 0 010-1.06z"
            fill="currentColor" />
        </svg>
      </button>
    </div>
    <div ref="scrollBody" class="flex-grow overflow-y-auto p-6 scrollbar-dark">
      <template v-if="contextData">
        <SearchSegmentContainer :searchData="contextData" :isLoading="isLoading"
          :highlightedPosition="highlightedPosition" :hideContextButton="true" class="w-full h-full" />
      </template>
      <div v-else-if="loadFailed" class="text-center py-10" data-testid="context-modal-error">
        <p class="text-red-400 text-sm">{{ t('searchpage.modalcontext.labels.loadError') }}</p>
        <button type="button"
          class="mt-3 py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
          @click="getContextSentence()">
          {{ t('searchContainer.retryButton') }}
        </button>
      </div>
    </div>
  </CommonBaseModal>
</template>
