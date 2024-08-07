<script setup>
import { mdiCheckBold } from '@mdi/js'

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
let isSuccess = ref(false)

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
  isError.value = false
  isSuccess.value = false
  isLoading.value = true
  try {
    await store.loadAnkiData()
    loadDeckOptions()
    isSuccess.value = true
  } catch (error) {
    isError.value = true
    console.error(error)
  } finally {
    isLoading.value = false
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

  <div class="anki">

    <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">Estado Sincronización</h3>
      <div class="border-b pt-4 border-white/10" />
      <div class="mt-4">
        <div class="flex justify-between items-center">
          <div class="w-full">
            <div v-if="isLoading" role="alert"
              class="rounded border-s-4 border-blue-500 bg-blue-50 p-4 dark:border-blue-600 dark:bg-blue-900/60">
              <div class="flex items-center gap-2 text-blue-800 dark:text-blue-100">
                <div role="status">
                  <svg aria-hidden="true"
                    class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                    viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                      fill="currentColor" />
                    <path
                      d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                      fill="currentFill" />
                  </svg>
                  <span class="sr-only">Loading...</span>
                </div>
                <strong class="block font-medium">Cargando...</strong>
              </div>
              <p class="mt-2 text-sm text-blue-700 dark:text-blue-200">
                Por favor, espere mientras se establece la conexión.
              </p>
            </div>

            <div v-if="isSuccess" role="alert"
              class="rounded border-s-4 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
              <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20"/>

                <strong class="block font-medium">Conexión establecida</strong>
              </div>
              <p class="mt-2 text-sm text-green-700 dark:text-green-200">
                La conexión con Anki se ha establecido de forma correcta.
              </p>
            </div>

            <div v-if="isError" role="alert"
              class="rounded border-s-4 border-red-500 bg-red-50 p-4 dark:border-red-600 dark:bg-red-900/70">
              <div class="flex items-center gap-2 text-red-800 dark:text-red-100">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                  <path fill-rule="evenodd"
                    d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
                    clip-rule="evenodd" />
                </svg>
                <strong class="block font-medium"> Algo ha fallado</strong>
              </div>
              <p class="mt-2 text-sm text-red-700 dark:text-red-200">
                No se ha podido establecer conexión con Anki.
              </p>
              <ol class="pl-5 text-sm dark:text-red-200 list-disc">
                <li>
                  Verifique que la aplicación de Anki este abierta y el addon
                  <a class="underline text-blue-400" href="https://ankiweb.net/shared/info/2055492159">Ankiconnect</a>
                  instalado.
                </li>
                <li>
                  Verifique que "https://db.brigadasos.xyz" este en el webCorsOriginList de las configuraciones de
                  AnkiConnect.
                </li>
                <li>
                  Deshabilite cualquier Adblock que tenga instalado en su navegador para este dominio.
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">Configuración Anki</h3>
      <div class="border-b pt-4 border-white/10" />
      <div class="mt-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:gap-8 mb-5">
          <div class="flex-grow">
            <label class="block text-lg mb-1 font-medium text-white"> Deck </label>
            <select v-model="selectedDeck"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
              <option value="">Selecciona un deck</option>
              <option v-for="(option, index) in deckOptions" :key="index" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
          <div class="flex-grow">
            <label class="block text-lg mb-1 font-medium text-white"> Modelo </label>
            <select v-model="selectedModel"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
              <option value="">Selecciona un modelo</option>
              <option v-for="(option, index) in modelOptions" :key="index" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="border rounded-lg overflow-hidden dark:border-modal-border">
        <table class="min-w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
          <thead>
            <tr class="divide-x bg-input-background divide-gray-200 dark:divide-white/30">
              <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Campo</th>
              <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Contenido</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-white/20">
            <tr class="divide-x divide-gray-200 dark:divide-white/20" v-for="(item, index) in fieldOptions">
              <td
                class="w-6/12 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                {{ item.key }}
              </td>
              <td class="whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                <div class="dark:bg-card-background border my-3 mx-2 rounded-lg dark:bg-slate-900 dark:border-white/20">
                  <div class="w-full flex justify-between items-center gap-x-1">
                    <div class="grow py-1 px-3">
                      <input v-model="item.value"
                        class="w-full p-0 bg-transparent border-0 text-gray-800 focus:ring-0 dark:text-white"
                        type="text" />
                    </div>
                    <div
                      class="flex flex-col -gap-y-px divide-y text-left divide-gray-200 border-s border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                      <div>
                        <div class="hs-dropdown relative inline-flex">
                          <button id="hs-dropdown-with-title" type="button"
                            class="w-7 h-10 rounded-e-md inline-flex justify-center items-center text-sm font-medium bg-gray-50 text-gray-800 hover:bg-gray-100 disabled:opacity-50 disabled:pointer-events-none dark:dark:bg-card-background dark:text-white dark:hover:bg-input-background dark:focus:outline-none dark:focus:ring-1 dark:focus:ring-gray-600">
                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 w-3.5 h-3.5" width="24"
                              height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                              stroke-linecap="round" stroke-linejoin="round">
                              <path fill-rule="evenodd" clip-rule="evenodd"
                                d="M4.29289 8.29289C4.68342 7.90237 5.31658 7.90237 5.70711 8.29289L12 14.5858L18.2929 8.29289C18.6834 7.90237 19.3166 7.90237 19.7071 8.29289C20.0976 8.68342 20.0976 9.31658 19.7071 9.70711L12.7071 16.7071C12.3166 17.0976 11.6834 17.0976 11.2929 16.7071L4.29289 9.70711C3.90237 9.31658 3.90237 8.68342 4.29289 8.29289Z"
                                fill="#000000" />
                            </svg>
                          </button>
                          <div
                            class="z-30 hs-dropdown-menu transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-input-background dark:divide-gray-700"
                            aria-labelledby="hs-dropdown-with-title">
                            <div class="py-2 first:pt-0 last:pb-0">
                              <span
                                class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                                Multimedia
                              </span>

                              <a @click="setKeyValueField(item.key, '{image}')"
                                class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-input-backgroundhover dark:hover:text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-0.5 0 25 25"
                                  fill="none">
                                  <path
                                    d="M21 22H3C2.72 22 2.5 21.6517 2.5 21.2083V3.79167C2.5 3.34833 2.72 3 3 3H21C21.28 3 21.5 3.34833 21.5 3.79167V21.2083C21.5 21.6517 21.28 22 21 22Z"
                                    stroke="white" stroke-miterlimit="10" stroke-linecap="round"
                                    stroke-linejoin="round" />
                                  <path
                                    d="M4.5 19.1875L9.66 12.6875C9.86 12.4375 10.24 12.4375 10.44 12.6875L15.6 19.1875"
                                    stroke="white" stroke-miterlimit="10" stroke-linecap="round"
                                    stroke-linejoin="round" />
                                  <path
                                    d="M16.2 16.6975L16.4599 16.3275C16.6599 16.0775 17.0399 16.0775 17.2399 16.3275L19.4999 19.1875"
                                    stroke="white" stroke-miterlimit="10" stroke-linecap="round"
                                    stroke-linejoin="round" />
                                  <path
                                    d="M17.2046 9.54315C17.2046 10.4294 16.4862 11.1478 15.6 11.1478C14.7138 11.1478 13.9954 10.4294 13.9954 9.54315C13.9954 8.65695 14.7138 7.93854 15.6 7.93854C16.4862 7.93854 17.2046 8.65695 17.2046 9.54315Z"
                                    stroke="#white" />
                                </svg>
                                {{ t('searchpage.main.buttons.image') }}
                              </a>
                              <a @click="setKeyValueField(item.key, '{sentence-audio}')"
                                class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-input-backgroundhover dark:hover:text-gray-300">
                                <svg class="flex-none" width="16" height="16" viewBox="0 0 130 130" fill="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                    d="M111.85,108.77c-3.47,4.82-8.39,8.52-14.13,10.48c-0.26,0.12-0.55,0.18-0.84,0.18c-0.28,0-0.56-0.06-0.82-0.17v0.06 c0,1.96-1.6,3.56-3.57,3.56l-7.68,0c-1.96,0-3.57-1.6-3.57-3.56l0-55.13c0-1.96,1.6-3.57,3.57-3.57h7.68c1.96,0,3.57,1.6,3.57,3.57 v0.34c0.26-0.12,0.54-0.18,0.82-0.18c0.22,0,0.44,0.04,0.64,0.1l0,0.01c4.36,1.45,8.26,3.92,11.42,7.11V59.15 c0-14.89-4.99-27.63-13.81-36.6l-3.91,5.83c-7.95-8.75-19.4-14.27-32.08-14.27c-12.76,0-24.29,5.59-32.24,14.45l-4.73-5.78 C13.47,31.65,8.54,44.21,8.54,59.15V73.4c3.4-4.08,7.92-7.22,13.07-8.93l0-0.01c0.21-0.07,0.43-0.11,0.64-0.11 c0.28,0,0.57,0.06,0.82,0.17v-0.34c0-1.96,1.61-3.57,3.57-3.57l7.68,0c1.96,0,3.57,1.6,3.57,3.57v55.13c0,1.96-1.61,3.56-3.57,3.56 h-7.68c-1.96,0-3.57-1.6-3.57-3.56v-0.06c-0.25,0.11-0.53,0.17-0.82,0.17c-0.3,0-0.58-0.07-0.83-0.18 c-5.74-1.96-10.66-5.66-14.13-10.48c-1.82-2.52-3.24-5.34-4.17-8.37l-3.12,0V59.15c0-16.27,6.65-31.05,17.37-41.77 C28.09,6.66,42.88,0,59.14,0c16.27,0,31.06,6.66,41.77,17.37c10.72,10.72,17.37,25.5,17.37,41.77v41.25h-2.27 C115.1,103.39,113.68,106.23,111.85,108.77L111.85,108.77L111.85,108.77z">
                                  </path>
                                </svg>
                                {{ t('searchpage.main.buttons.audio') }}
                              </a>
                            </div>
                            <div class="py-2 first:pt-0 last:pb-0">
                              <span
                                class="block py-2 px-3 text-xs font-medium uppercase text-gray-400 dark:text-gray-500">
                                {{ t('searchpage.main.labels.text') }}
                              </span>
                              <a @click="setKeyValueField(item.key, '{sentence-jp}')"
                                class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-input-backgroundhover dark:hover:text-gray-300">
                                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path
                                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                                  <path
                                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                                </svg>
                                {{ t('searchpage.main.buttons.jpsentence') }}
                              </a>
                              <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-input-backgroundhover dark:hover:text-gray-300"
                                @click="setKeyValueField(item.key, '{sentence-en}')">
                                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path
                                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                                  <path
                                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                                </svg>
                                {{ t('searchpage.main.buttons.ensentence') }}
                              </a>
                              <a class="flex cursor-pointer items-center gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-input-backgroundhover dark:hover:text-gray-300"
                                @click="setKeyValueField(item.key, '{sentence-es}')">
                                <svg class="flex-none" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <path
                                    d="M1.92.506a.5.5 0 0 1 .434.14L3 1.293l.646-.647a.5.5 0 0 1 .708 0L5 1.293l.646-.647a.5.5 0 0 1 .708 0L7 1.293l.646-.647a.5.5 0 0 1 .708 0L9 1.293l.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .708 0l.646.647.646-.647a.5.5 0 0 1 .801.13l.5 1A.5.5 0 0 1 15 2v12a.5.5 0 0 1-.053.224l-.5 1a.5.5 0 0 1-.8.13L13 14.707l-.646.647a.5.5 0 0 1-.708 0L11 14.707l-.646.647a.5.5 0 0 1-.708 0L9 14.707l-.646.647a.5.5 0 0 1-.708 0L7 14.707l-.646.647a.5.5 0 0 1-.708 0L5 14.707l-.646.647a.5.5 0 0 1-.708 0L3 14.707l-.646.647a.5.5 0 0 1-.801-.13l-.5-1A.5.5 0 0 1 1 14V2a.5.5 0 0 1 .053-.224l.5-1a.5.5 0 0 1 .367-.27zm.217 1.338L2 2.118v11.764l.137.274.51-.51a.5.5 0 0 1 .707 0l.646.647.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.646.646.646-.646a.5.5 0 0 1 .708 0l.509.509.137-.274V2.118l-.137-.274-.51.51a.5.5 0 0 1-.707 0L12 1.707l-.646.647a.5.5 0 0 1-.708 0L10 1.707l-.646.647a.5.5 0 0 1-.708 0L8 1.707l-.646.647a.5.5 0 0 1-.708 0L6 1.707l-.646.647a.5.5 0 0 1-.708 0L4 1.707l-.646.647a.5.5 0 0 1-.708 0l-.509-.51z" />
                                  <path
                                    d="M3 4.5a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 1 1 0 1h-6a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5zm8-6a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zm0 2a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5z" />
                                </svg>
                                {{ t('searchpage.main.buttons.essentence') }}
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <section v-if="isLoading" class="container border-modal-border rounded-xl px-4 mx-auto">
          <div class="flex items-center my-6 text-center rounded-lg h-96">
            <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
              <div class="p-1.5 min-w-full inline-block align-middle">
                <span
                  class="animate-spin text-center inline-block mt-1 mr-2 w-10 h-10 border-[3px] border-current border-t-transparent border-sred text-white rounded-full"
                  role="status">
                </span>
              </div>
            </div>
          </div>
        </section>
        <section v-else-if="deckOptions.length === 0 && !isLoading" class="rounded-xl mx-auto">
          <div class="flex items-center text-center h-96 dark:border-gray-700 bg-input-backgroundhover">
            <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
              <div class="p-3 mx-auto text-sred bg-blue-100 rounded-full dark:bg-input-background">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                  stroke="currentColor" class="w-6 h-6">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <h1 class="mt-3 text-lg text-gray-800 dark:text-white">No se han encontrado campos</h1>
              <p class="mt-2 text-gray-500 dark:text-gray-400">
                Por favor, intenta de nuevo o verifica tu conexión con AnkiConnect.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>