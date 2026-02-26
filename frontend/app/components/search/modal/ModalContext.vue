<script setup lang="ts">
import type { SearchResponse, SearchResult } from '~/types/search';
import { resolveContextResponse } from '~/utils/resolvers';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const { mediaName } = useMediaName();
const props = defineProps<{ sentence: SearchResult | null }>();

const sdk = useNadeshikoSdk();
const { contentRating } = useContentRating();

const isLoading = ref(false);
const contextData = ref<SearchResponse | null>(null);
const highlightedPosition = ref<number | null>(null);

const getContextSentence = async () => {
  const sentence = props.sentence;
  if (!sentence || isLoading.value) return;
  isLoading.value = true;
  contextData.value = null;

  try {
    const { data } = await sdk.getSegmentContext({
      path: { uuid: sentence.segment.uuid },
      query: {
        take: 15,
        contentRating: contentRating.value,
      },
    });
    const response = data ? resolveContextResponse(data) : { segments: [] };
    contextData.value = { results: response.segments };
    highlightedPosition.value = sentence.segment.position;
    await nextTick();

    const match = response?.segments?.find((s: SearchResult) => s.segment.position === sentence.segment.position);
    if (match) {
      scrollToElement(match.segment.uuid);
    }
  } catch (error) {
    // Context fetch failed - UI shows empty state
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

const scrollToElement = (id: string) => {
  nextTick(() => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }
  });
};
</script>

<template>
  <div id="nd-vertically-centered-scrollable-context"
    class="nd-overlay nd-overlay-backdrop-open:bg-neutral-900/60 hidden w-full h-full flex items-center justify-center fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      class="w-full max-w-7xl mx-auto h-full max-h-[95vh] flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border">
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('searchpage.modalcontext.labels.context') }} - {{
            contextData?.results?.[0]?.media ? mediaName(contextData.results[0].media) : '' }}
        </h3>
        <button type="button"
          class="nd-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
          data-nd-overlay="#nd-vertically-centered-scrollable-context">
          <span class="sr-only">{{ t('modalContext.closeSrOnly') }}</span>
          <svg class="w-3.5 h-3.5" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0.258 1.007a.75.75 0 011.06 0L3.612 3.653 6.258 1.007a.75.75 0 111.06 1.06L4.672 4.36l2.647 2.647a.75.75 0 11-1.06 1.06L3.612 5.42l-2.647 2.646a.75.75 0 11-1.06-1.06L2.553 4.36.258 2.067a.75.75 0 010-1.06z"
              fill="currentColor" />
          </svg>
        </button>
      </div>
      <div class="flex-grow overflow-y-auto p-6">
        <template v-if="contextData">
          <SearchSegmentContainer :searchData="contextData" :isLoading="isLoading"
            :highlightedPosition="highlightedPosition" :hideContextButton="true" class="w-full h-full" />
        </template>
      </div>
    </div>
  </div>
</template>
