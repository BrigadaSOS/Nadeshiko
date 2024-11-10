<script setup>

const selectedOption = ref('')
let words = ref('')
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { mdiTagSearchOutline } from '@mdi/js'
const apiSearch = useApiSearch();

const inputText = ref('')
const wordCount = ref(0)
const errorMessage = ref('')
const wordsMatch = ref([])
const totalWordsSearched = ref(0)
const checkExactSearch = ref(false)
let isLoading = ref(false)

const sortedWordsMatch = computed(() => {
  // Ordenar las palabras por item.total_matches de manera descendente,
  // luego por item.is_match de manera descendente
  const sortedItems = wordsMatch.value.slice().sort((a, b) => {
    const aTotalMatches = Number(a.total_matches)
    const bTotalMatches = Number(b.total_matches)

    if (aTotalMatches > bTotalMatches) return -1
    if (aTotalMatches < bTotalMatches) return 1
    if (a.is_match && !b.is_match) return -1
    if (!a.is_match && b.is_match) return 1
    return 0
  })

  return sortedItems
})

const getWordMatch = async () => {
  if (words.value.length === 0) {
    return;
  }

  isLoading.value = true
  HSOverlay.open(document.querySelector("#hs-vertically-centered-scrollable-batch2"));

  let body = {
    words: words.value
  };

  // Fetch data from API      
  try {
    const response = await apiSearch.getMultipleSearch(body);
    wordsMatch.value = response.results
    totalWordsSearched.value = words.value.length
  } catch (e) {
    useToastError(e);
  } finally {
    isLoading.value = false
  }
}

const percentageMatched = computed(() => {
  const totalMatches = sortedWordsMatch.value.filter((item) => item.is_match).length
  return (totalMatches / totalWordsSearched.value) * 100
})

const wordsFound = computed(() => {
  return sortedWordsMatch.value.filter((item) => item.is_match).length
})

watch(inputText, (newValue) => {
  words.value = newValue
    .replace(/[\n\r]+/g, ',')
    .replace(/[-*]/g, '')
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '')

  if (words.value.length > 200) {
    errorMessage.value = `Se ha excedido el límite de palabras permitidas: ${words.value.length} / 200`
    wordCount.value = words.value.length
  } else if (newValue.includes(',') && newValue.includes('\n')) {
    errorMessage.value = 'El formato de entrada es incorrecto. Verifique si hay comas y saltos de línea simultáneos.'
    wordCount.value = 'No disponible'
  } else {
    errorMessage.value = ''
    wordCount.value = words.value.length
  }
})
</script>

<template>
  <div id="hs-vertically-centered-scrollable-batch"
    class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center">
      <div
        class="max-h-full flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border">
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
          <h3 class="font-bold text-gray-800 dark:text-white">{{ t("batchSearch.title") }}</h3>
          <button type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-batch">
            <span class="sr-only">Close</span>
            <svg class="w-3.5 h-3.5" width="8" height="8" viewBox="0 0 8 8" fill="none"
              xmlns="http://www.w3.org/2000/svg">
              <path
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor" />
            </svg>
          </button>
        </div>
        <div class="overflow-y-auto">
          <div class="flex flex-row mx-auto">
            <div class="sm:mx-4 mx-auto flex flex-col">
              <div class="p-6 space-y-6 flex flex-col">
                <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
                  {{ t("batchSearch.description1") }}.
                  <br />
                  <br />
                  {{ t("batchSearch.description2") }}.
                  <span class="underline underline-offset-4">{{ t("batchSearch.description3") }}</span>.
                  {{ t("batchSearch.description4") }}<span class="underline underline-offset-4">{{
                    t("batchSearch.description5") }}</span>.
                </p>

                <textarea v-model="inputText" autocomplete="off" rows="10"
                  class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 dark:text-white dark:focus:ring-white/10 dark:focus:border-white/10"
                  placeholder="彼女&#10;彼氏&#10;走る&#10;恋人&#10;...&#10;...&#10;..."></textarea>

              </div>
              <div class="px-4 sm:px-6 overflow-y-auto">
                <div class="space-y-4">
                  <!-- Card -->
                  <div
                    class="flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-input dark:border-modal-border">
                    <label for="hs-account-activity" class="flex p-4 md:p-5">
                      <span class="flex mr-5">

                        <UiBaseIcon :path="mdiTagSearchOutline" w="w-5 md:w-5" h="h-5 md:h-5" size=25 class="mt-1" />
                        <span class="ml-5">
                          <span class="block font-medium text-gray-800 dark:text-gray-200">{{
                            t("searchSettingsModal.exactMatchTitle") }}</span>
                          <span class="block text-sm text-gray-500">{{ t("searchSettingsModal.exactMatchDescription")
                            }}</span>
                        </span>
                      </span>

                      <input type="checkbox" id="hs-account-activity" v-model="checkExactSearch"
                        class="relative shrink-0 w-[3.25rem] ml-auto h-7 bg-gray-100 checked:bg-none checked:bg-blue-600 rounded-full cursor-pointer transition-colors ease-in-out duration-200 border border-transparent ring-1 ring-transparent  ring-offset-white focus:outline-none appearance-none dark:bg-neutral-700 dark:checked:bg-blue-600 dark:focus:ring-offset-gray-800
              before:inline-block before:w-6 before:h-6 before:bg-white checked:before:bg-blue-200 before:translate-x-0 checked:before:translate-x-full before:shadow before:rounded-full before:transform before:ring-0 before:transition before:ease-in-out before:duration-200 dark:before:bg-gray-400 dark:checked:before:bg-blue-200">
                    </label>
                  </div>
                  <!-- End Card -->
                </div>
              </div>
              <div v-if="errorMessage" class="p-4 sm:p-6 ml-auto text-red-500">{{ errorMessage }}</div>
              <div v-if="!errorMessage" class="p-4 sm:p-6  leading-relaxed text-gray-500 dark:text-gray-400 ml-auto">
                {{ t("batchSearch.totalWords") }}: {{ wordCount }} / 200
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
          <button type="button" @click="getWordMatch"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-modal-border dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800">
            {{ t("batchSearch.search") }}
          </button>
          <button type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-modal-border dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-batch">
            {{ t("batchSearch.close") }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div id="hs-vertically-centered-scrollable-batch2"
    class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto flex flex-col h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)]">
      <div
        class="max-h-full flex flex-col bg-white border dark:border-modal-border shadow-sm rounded-xl dark:bg-modal-background">
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
          <h3 class="font-bold text-gray-800 dark:text-white">{{ t("batchSearch.results.title") }}</h3>
          <button type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-batch2">
            <span class="sr-only">Close</span>
            <svg class="w-3.5 h-3.5" width="8" height="8" viewBox="0 0 8 8" fill="none"
              xmlns="http://www.w3.org/2000/svg">
              <path
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor" />
            </svg>
          </button>
        </div>
        <div class="p-4 overflow-y-auto">
          <div class="flex flex-col">
            <div class="-m-1.5 overflow-x-auto">
              <div v-if="!isLoading" class="p-1.5 min-w-full inline-block align-middle">
                <div class="mb-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400 ml-auto">
                  Tipo de busqueda: {{ checkExactSearch ? "Exacta" : "Normal" }}
                  <br />
                  {{ t("batchSearch.results.words") }}: {{ wordCount }}
                  <br />
                  {{ t("batchSearch.results.wordsWithMatch") }}: {{ wordsFound }}
                  <br />
                  {{ t("batchSearch.results.percentageMatched") }}: {{ percentageMatched.toFixed(2) }}%
                </div>
                <div class="border rounded-lg shadow overflow-hidden dark:border-modal-border dark:shadow-gray-900">
                  <table class="min-w-full divide-y dark:bg-neutral-800 divide-gray-200 dark:divide-white/30">
                    <thead>
                      <tr class="divide-x divide-gray-200 dark:divide-white/30">
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          {{ t("batchSearch.results.wordColumn") }}
                        </th>
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          {{ t("batchSearch.results.match") }}
                        </th>
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          {{ t("batchSearch.results.matchesCount") }}
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/30">
                      <tr v-for="(item, index) in sortedWordsMatch">
                        <td
                          class="y-4 whitespace-nowrap text-base text-center font-medium text-gray-800 dark:text-gray-200">
                          <NuxtLink v-if="item.is_match" :to="{
                            path: '/search/sentence',
                            query: { query: item.word }
                          }" class="text-blue-500 underline-offset-2 underline" target="_blank">
                            {{ item.word }}
                          </NuxtLink>
                          <span v-else>
                            {{ item.word }}
                          </span>
                        </td>

                        <td
                          class="py-4 whitespace-nowrap text-base font-medium text-gray-800 dark:text-gray-200 flex justify-center items-center">
                          <span :class="{
                            'bg-green-500/20 text-white': item.is_match,
                            'bg-red-500/20 text-white': !item.is_match
                          }"
                            class="bg-gray-100 mb-1 text-gray-800 text-xs font-medium flex justify-center items-center px-2.5 py-0.5 rounded w-full border dark:border-modal-border text-center">
                            {{ item.is_match ? t("batchSearch.results.true") : t("batchSearch.results.false") }}
                          </span>
                        </td>

                        <td
                          class="py-4 whitespace-nowrap text-center text-base font-medium text-gray-800 dark:text-gray-200">
                          {{ item.total_matches }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div v-else-if="isLoading" class="p-1.5 min-w-full inline-block align-middle">
                <span
                  class="animate-spin text-center inline-block mt-1 mr-2 w-5 h-5 border-[3px] border-current border-t-transparent text-white rounded-full"
                  role="status" aria-label="loading">
                  <span class="sr-only">Loading...</span>
                </span>
                {{ t("batchSearch.results.searching") }}
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
          <button type="button"
            class="h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-modal-border dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-batch">
            {{ t("batchSearch.results.return") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
