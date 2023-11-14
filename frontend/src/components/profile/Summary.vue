<script setup>
import { ref, onMounted, watch } from 'vue'
import Tabs from '../minimal/Tabs.vue'
import Tab from '../minimal/Tab.vue'
import { ankiStore } from '../../stores/anki'

const store = ankiStore()

let isError = ref(false)
let settings = ref(null)
let deckOptions = ref([])
let selectedDeck = ref('')
let modelOptions = ref([])
let selectedModel = ref('')
let fieldOptions = ref([])

const loadDeckOptions = () => {
  settings = localStorage.getItem('settings')
  if (settings) {
    settings = JSON.parse(settings)

    if (settings.ankiPreferences.settings.current.deck) {
      selectedDeck.value = store.ankiPreferences.settings.current.deck
    }

    if (settings.ankiPreferences.availableDecks) {
      deckOptions.value = settings.ankiPreferences.availableDecks
    }

    if (settings.ankiPreferences.settings.current.model) {
      selectedModel.value = settings.ankiPreferences.settings.current.model
    }

    if (settings.ankiPreferences.availableModels) {
      modelOptions.value = settings.ankiPreferences.availableModels
    }

    if (settings.ankiPreferences.settings.current.fields) {
      fieldOptions.value = settings.ankiPreferences.settings.current.fields
    }
  }
}

onMounted(async () => {
  try {
    await store.loadAnkiData()
    loadDeckOptions()
  } catch (error) {
    isError.value = true
  }
})

watch(selectedModel, async (newValue, oldValue) => {
  if (newValue !== oldValue) {
    try {
      store.ankiPreferences.settings.current.model = newValue
      const data = await store.getAllModelFieldNames(newValue)
      if (data && data.result) {
        const newFields = data.result.map((field) => ({
          key: field,
          value: null
        }))
        store.ankiPreferences.settings.current.fields = newFields
        fieldOptions.value = newFields
      }
    } catch (error) {
      console.error('Error al cargar nombres de campos del modelo:', error)
    }
  }
})

watch(selectedDeck, async (newValue, oldValue) => {
  store.ankiPreferences.settings.current.deck = newValue
})
</script>

<template>
  <div class="container sm:max-w-screen-lg md:max-w-screen-2xl mx-auto flex flex-col">
    <Tabs class="mt-2">
      <Tab active="true" title="Anki">
        <div
          role="alert"
          v-if="isError"
          class="rounded border-s-4 border-red-500 bg-red-50 p-4 dark:border-red-600 dark:bg-red-900"
        >
          <div class="flex items-center gap-2 text-red-800 dark:text-red-100">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
              <path
                fill-rule="evenodd"
                d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                clip-rule="evenodd"
              />
            </svg>

            <strong class="block font-medium"> Algo ha fallado</strong>
          </div>

          <p class="mt-2 text-sm text-red-700 dark:text-red-200">
            No se ha podido establecer conexión con Anki. 
            <ol class="pl-5 list-disc">
              <li>
                Verifique que la aplicación de Anki este abierta y el addon
            <a class="underline text-blue-400" href="https://ankiweb.net/shared/info/2055492159">Ankiconnect</a>
            instalado.
              </li>
              <li>
                Verifique que "https://db.brigadasos.xyz" este en el webCorsOriginList de tus configuraciones de AnkiConnect.
              </li>
            </ol>
          </p>
        </div>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-4 lg:gap-8 mb-4 mt-2">
          <div class="rounded-lg col-span-2">
            <div class="">
              <label class="block text-lg mb-1 font-medium text-white"> Deck </label>
              <select
                v-model="selectedDeck"
                class="w-full resize-none text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
              >
                <option value="">Selecciona un deck</option>
                <option v-for="(option, index) in deckOptions" :key="index" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
          </div>
          <div class="rounded-lg col-span-2">
            <div class="">
              <label class="block text-lg mb-1 font-medium text-white"> Modelo </label>
              <select
                v-model="selectedModel"
                class="w-full resize-none text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-sgray dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500"
              >
                <option value="">Selecciona un modelo</option>
                <option v-for="(option, index) in modelOptions" :key="index" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
          </div>
        </div>
        <div class="border rounded-lg shadow overflow-hidden dark:border-sgray2 dark:shadow-gray-900">
          <table class="min-w-full divide-y bg-sgray2 divide-gray-200 dark:divide-white/30">
            <thead>
              <tr class="divide-x bg-sgray divide-gray-200 dark:divide-white/30">
                <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Campo</th>
                <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Contenido</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200 dark:divide-white/20">
              <tr class="divide-x divide-gray-200 dark:divide-white/20" v-for="(item, index) in fieldOptions">
                <td
                  class="py-4 w-5/12 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200"
                >
                  {{ item.key }}
                </td>

                <td class="whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                  {{ item.value }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Tab>
    </Tabs>
  </div>
</template>
