<script setup>
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const props = defineProps(['sentence']);

const apiSearch = useApiSearch();

let isLoading = ref(false)
let finalsentences = ref([])
let currentSentenceIndex = ref(null)

const getContextSentence = async () => {
  if (!props.sentence || isLoading.value) return;
  isLoading.value = true;
  finalsentences.value = []

  try {
    const response = await apiSearch.getContextSentence({
      media_id: props.sentence.basic_info.id_anime,
      season: props.sentence.basic_info.season,
      episode: props.sentence.basic_info.episode,
      segment_position: props.sentence.segment_info.position,
      limit: 15
    });
    finalsentences.value = response;
    currentSentenceIndex.value = props.sentence.segment_info.position;
    await nextTick()
    scrollToElement(currentSentenceIndex.value)

  } catch (error) {
    console.error('Error fetching context sentences:', error);
  } finally {
    isLoading.value = false;
  }
};

watch(() => props.sentence, (newVal) => {
  if (newVal) {
    getContextSentence();
  }
});

const scrollToElement = (pos) => {
  nextTick(() => {
    const el = document.getElementById(pos)
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  })
}
</script>

<template>
  <div id="hs-vertically-centered-scrollable-context"
    class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/60 hidden w-full h-full flex items-center justify-center fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      class="w-full max-w-7xl mx-auto h-full max-h-[95vh] flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border">
      <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
        <h3 class="font-bold text-gray-800 dark:text-white">
          {{ t('searchpage.modalcontext.labels.context') }} - {{
            finalsentences?.sentences?.[0]?.basic_info?.name_anime_en }}
        </h3>
        <button type="button"
          class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
          data-hs-overlay="#hs-vertically-centered-scrollable-context">
          <span class="sr-only">{{ t('modalContext.closeSrOnly') }}</span>
          <svg class="w-3.5 h-3.5" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0.258 1.007a.75.75 0 011.06 0L3.612 3.653 6.258 1.007a.75.75 0 111.06 1.06L4.672 4.36l2.647 2.647a.75.75 0 11-1.06 1.06L3.612 5.42l-2.647 2.646a.75.75 0 11-1.06-1.06L2.553 4.36.258 2.067a.75.75 0 010-1.06z"
              fill="currentColor" />
          </svg>
        </button>
      </div>
      <div class="flex-grow overflow-y-auto p-6">
        <template v-if="finalsentences">
          <SearchSegmentContainer :searchData="finalsentences" :isLoading="isLoading"
            :currentSentenceIndex="currentSentenceIndex" class="w-full h-full" />
        </template>
      </div>
      <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
        <button type="button"
          class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-modal-border dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
          data-hs-overlay="#hs-vertically-centered-scrollable-context">
          {{ t("batchSearch.close") }}
        </button>
      </div>
    </div>
  </div>
</template>