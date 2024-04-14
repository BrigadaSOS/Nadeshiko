<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import Tabs from '../minimal/Tabs.vue'
import Tab from '../minimal/Tab.vue'
import { ankiStore } from '../../stores/anki'
import { userStore } from '../../stores/user'

import FileExplorer from './FileExplorer.vue'
// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

const store = ankiStore()
const user_store = userStore()
const user = computed(() => user_store.userInfo)

let isError = ref(false)
let isLoading = ref(false)
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

    if (settings.ankiPreferences.settings.current.fields) {
      fieldOptions.value = settings.ankiPreferences.settings.current.fields
    }

    if (settings.ankiPreferences.settings.current.model) {
      selectedModel.value = settings.ankiPreferences.settings.current.model
    }

    if (settings.ankiPreferences.availableModels) {
      modelOptions.value = settings.ankiPreferences.availableModels
    }
  }
}

const setKeyValueField = (fieldName, value) => {
  const field = fieldOptions.value.find((field) => field.key === fieldName)
  if (field) {
    field.value = value
  }
}

onMounted(async () => {
  try {
    isLoading.value = true
    await store.loadAnkiData()
    loadDeckOptions()
    isLoading.value = false
  } catch (error) {
    isError.value = true
    isLoading.value = false
    console.error(error)
  }
})

watch(selectedModel, async (newValue, oldValue) => {
  if (newValue !== oldValue) {
    try {
      store.ankiPreferences.settings.current.model = newValue
      const data = await store.getAllModelFieldNames(newValue)
      if (data && data.result) {
        const newFields = data.result.map((field) => {
          const existingField = fieldOptions.value.find((f) => f.key === field)
          return {
            key: field,
            value: existingField ? existingField.value : ''
          }
        })
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

watch(deckOptions, async (newValue, oldValue) => {
  store.ankiPreferences.settings.current.fields = newValue
})
</script>

<template>
  <div class="bg-[#181a1b] p-10 text-white min-h-screen">
    <div class="container mx-auto">
      <!-- Settings Header -->
      <div class="mb-4">
        <h1 class="text-3xl font-semibold">Settings</h1>
        <div class="mt-2">
          <nav class="flex space-x-4">
            <a href="#" class="text-gray-300 hover:text-white">Account</a>
            <a href="#" class="text-gray-300 hover:text-white">Team</a>
            <a href="#" class="text-gray-300 hover:text-white">Apps</a>
            <a href="#" class="text-gray-300 hover:text-white">Podcast and audio</a>
            <a href="#" class="text-gray-300 hover:text-white">Email notifications</a>
            <a href="#" class="text-gray-300 hover:text-white">Billing and payouts</a>
          </nav>
        </div>
      </div>

      <!-- Monetization Card -->
      <div class="bg-gray-700 p-6 rounded-lg">
        <div class="flex justify-between items-center">
          <div>
            <h2 class="text-xl font-semibold">Monetization</h2>
            <p class="text-gray-400">Pro plan + 8% fee + applicable fees and taxes</p>
            <a href="#" class="text-blue-500 hover:underline">View fees</a>
            <p class="mt-2 text-gray-300">Get paid by offering a paid membership or selling digital products in your shop. You only pay fees when you start earning. <a href="#" class="text-blue-500 hover:underline">Learn more</a></p>
          </div>
          <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
            Change plan
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
