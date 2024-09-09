<script setup lang="ts">

import { useI18n } from 'vue-i18n'
const { t } = useI18n()
import { mdiPlus } from '@mdi/js'

type Props = {
  sentence: Sentence | null;
  onClick: (sentece: Sentence, id: number) => void;
};
const props = defineProps<Props>();

// const keyValue = ref("Word");
const inputVal = ref("");
const resLength = ref(0);
const notes = ref([]);

const store = ankiStore()


watch(() => props.sentence, async () => {
  const regex = /<em>(.*?)<\/em>/;
  const match = props.sentence?.segment_info.content_jp_highlight.match(regex);

  if (match) {
    inputVal.value = match[1];
  }

  await getNotesFromQuery();
});

// Try to get keyValue from localStorage
// const keyValueStorage = localStorage.getItem("keyValue");
// if (keyValueStorage) {
//   keyValue.value = keyValueStorage;
// }

const executeAction = async (action: string, params: Object) => {
  try {
    const response = await fetch("http://localhost:8765", {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: action,
        params: params,
        version: 6,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${action}.`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error while requesting ${action}:`, error);
    throw error;
  }
};


const getNotesFromQuery = async () => {
  try {
    const currentKey = store.ankiPreferences.settings.current.key
      ? store.ankiPreferences.settings.current.key : "";

    const currentDeck = store.ankiPreferences.settings.current.deck
      ? `"deck:${store.ankiPreferences.settings.current.deck}"` : "";

    const query = `${currentDeck} ${currentKey}:\*${inputVal.value}*`;

    const response = await executeAction("findNotes", { query: query });

    if (response.result && response.result.length === 0) {
      notes.value = [];
      resLength.value = 0;
      return;
    }

    resLength.value = response.result.length;

    const notesRes = await executeAction("notesInfo", {
      notes: response.result.slice(0, 5),
    });
    const notesInfo = notesRes.result.map((note) => {
      if (!note.fields[currentKey]) {
        return { noteId: note.noteId, value: "None" };
      }
      return { noteId: note.noteId, value: note.fields[currentKey].value };
    });

    notes.value = notesInfo;
  } catch (error) {
    console.error("Error while fetching notes:", error);
  }
};
</script>

<template>
  <div id="hs-vertically-centered-scrollable-anki-collection"
    class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto">
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center">
      <div
        class="max-h-full flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border">
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border">
          <h3 class="font-bold text-gray-800 dark:text-white">
            {{ t("ankiSearch.title") }}
          </h3>
          <button type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-anki-collection">
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
            <!-- Contenido -->
            <div class="sm:mx-4 mx-auto flex flex-col">
              <div class="p-6 space-y-6 flex flex-col">
                <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
                  {{ t("ankiSearch.description") }}
                  <br />
                </p>

                <input :value="inputVal" @input="(e: any) => { inputVal = e.target.value; getNotesFromQuery(); }"
                  autocomplete="off"
                  class="block p-2.5 w-full text-sm text-gray-900 rounded-lg border border-gray-300 focus:ring-white/50 focus:border-white/50 dark:bg-modal-input dark:border-white/5 dark:placeholder-gray-400 dark:text-white dark:focus:ring-white/10 dark:focus:border-white/10"
                  placeholder="女"></input>

                <div class="mt-6">
                  <div class="border rounded-lg h-96 overflow-hidden dark:border-modal-border">
                    <table class="w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
                      <thead>
                        <tr class=" bg-input-background divide-gray-200 dark:divide-white/30">
                          <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">ID
                          </th>
                          <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                            {{ store.ankiPreferences.settings.current.key ? store.ankiPreferences.settings.current.key :
                              "Key" }}
                          </th>
                          <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                          </th>
                        </tr>
                      </thead>

                      <tbody class="divide-y divide-gray-200 dark:divide-white/20">
                        <tr v-for="note in notes" class="divide-gray-200 text-center dark:divide-white/20">
                          <td
                            class="w-2/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                            {{ note.noteId }}
                          </td>
                          <td
                            class="w-2/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                            {{ note.value }}
                          </td>
                          <td class="w-1/12">
                            <UiButtonPrimaryAction 
                              data-hs-overlay="#hs-vertically-centered-scrollable-anki-collection"
                              @click="props.onClick(sentence!, note.noteId)">
                              <UiBaseIcon :path="mdiPlus" />
                            </UiButtonPrimaryAction>
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    <section v-if="notes.length === 0" class="rounded-xl mx-auto">
                      <div class="flex items-center text-center h-96 dark:border-gray-700 bg-sgrayhover">
                        <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                          <div class="p-3 mx-auto bg-blue-100 rounded-full dark:bg-card-background">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                              stroke="currentColor" class="w-6 h-6">
                              <path stroke-linecap="round" stroke-linejoin="round"
                                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                            </svg>
                          </div>
                          <h1 class="mt-3 text-lg text-gray-800 dark:text-white">No se ha encontrado ninguna carta</h1>
                          <p class="mt-2 text-gray-500 dark:text-gray-400">
                            Prueba usando otro query o mina la oracion antes.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-modal-border">
          <button type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-modal-border dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-anki-collection">
            {{ t("batchSearch.close") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
