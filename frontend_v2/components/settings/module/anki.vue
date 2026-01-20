<script setup>
import { mdiCheckBold } from '@mdi/js'
import { mdiText, mdiImage, mdiVideo, mdiContentCopy, mdiVolumeHigh } from '@mdi/js'

// Language configuration
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

const store = ankiStore()
const user_store = userStore()

const user = computed(() => user_store.userInfo)

let isError = ref(false)
let isLoading = ref(false)
let deckOptions = ref([])
let selectedDeck = ref('')
let modelOptions = ref([])
let selectedModel = ref('')
let fieldOptions = ref([])
let isSuccess = ref(false)
let modelKey = ref(null);

// advanced settings
let ankiconnectAddress = ref("http://127.0.0.1:8765");

const loadSettings = (loadDeckInfo = false) => {
  let settings = localStorage.getItem('settings')
  if (settings) {
    settings = JSON.parse(settings)

    if (loadDeckInfo) {

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

      if (settings.ankiPreferences.settings.current.key) {
        modelKey.value = settings.ankiPreferences.settings.current.key;
      }
    }

    if (settings.ankiPreferences.serverAddress) {
      ankiconnectAddress.value = settings.ankiPreferences.serverAddress;
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
  loadSettings();
  await fetchAndLoad();
});

const fetchAndLoad = async () => {
  isError.value = false
  isSuccess.value = false
  isLoading.value = true
  try {
    await store.loadAnkiData()
    // true parameter means we also load the deck info
    loadSettings(true)
    isSuccess.value = true
  } catch (error) {
    isError.value = true
    console.error(error)
  } finally {
    isLoading.value = false
  }
};

watch(selectedModel, async (newValue, oldValue) => {
  if (newValue !== oldValue) {
    try {
      store.ankiPreferences.settings.current.model = newValue
      const data = await store.getAllModelFieldNames(newValue)
      if (data) {
        const newFields = data.map((field) => {
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
      console.error(t('accountSettings.anki.fieldLoadError'), error)
    }
  }
})

watch(selectedDeck, async (newValue) => {
  store.ankiPreferences.settings.current.deck = newValue;
})

watch(modelKey, async (newValue) => {
  store.ankiPreferences.settings.current.key = newValue;
});

watch(fieldOptions, (newValue) => {
  store.ankiPreferences.settings.current.fields = newValue;
}, { deep: true });

// Every time the address change, we try to connect to anki
watch(ankiconnectAddress, (newValue) => {
  store.ankiPreferences.serverAddress = newValue;

  // Before loading, we clear fieldOptions to hide the table
  fieldOptions.value = [];

  fetchAndLoad();
});

</script>
<template>

  <div class="anki">

    <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.anki.syncStatus') }}</h3>
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
                <strong class="block font-medium">{{ $t('accountSettings.anki.loading') }}</strong>
              </div>
              <p class="mt-2 text-sm text-blue-700 dark:text-blue-200">
                {{ $t('accountSettings.anki.loadingMessage') }}
              </p>
            </div>

            <div v-if="isSuccess" role="alert"
              class="rounded border-s-4 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
              <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20" />

                <strong class="block font-medium">{{ $t('accountSettings.anki.connectionSuccess') }}</strong>
              </div>
              <p class="mt-2 text-sm text-green-700 dark:text-green-200">
                {{ $t('accountSettings.anki.successMessage') }}
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
                <strong class="block font-medium">{{ $t('accountSettings.anki.connectionError') }}</strong>
              </div>
              <p class="mt-2 text-sm text-red-700 dark:text-red-200">
                {{ $t('accountSettings.anki.errorMessage') }}
              </p>
              <ol class="pl-5 text-sm dark:text-red-200 list-disc">
                <li>
                  {{ $t('accountSettings.anki.troubleshootingTips.ankiRunning') }}
                  <a class="underline text-blue-400" href="https://ankiweb.net/shared/info/2055492159">Ankiconnect</a>
                </li>
                <li>
                  {{ $t('accountSettings.anki.troubleshootingTips.webCors') }}
                </li>
                <li>
                  {{ $t('accountSettings.anki.troubleshootingTips.adBlock') }}
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="dark:bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.anki.ankiConfig') }}</h3>
      <div class="border-b pt-4 border-white/10" />
      <div class="mt-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:gap-8 mb-5">
          <div class="flex-grow">
            <label class="block text-lg mb-1 font-medium text-white">{{ $t('accountSettings.anki.deckLabel') }}</label>
            <select v-model="selectedDeck"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
              <option value="">{{ $t('accountSettings.anki.selectDeck') }}</option>
              <option v-for="(option, index) in deckOptions" :key="index" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
          <div class="flex-grow">
            <label class="block text-lg mb-1 font-medium text-white">{{ $t('accountSettings.anki.modelLabel') }}</label>
            <select v-model="selectedModel"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
              <option value="">{{ $t('accountSettings.anki.selectModel') }}</option>
              <option v-for="(option, index) in modelOptions" :key="index" :value="option">
                {{ option }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <div class="flex flex-col gap-4 lg:flex-row lg:gap-8 mb-5">
          <div class="flex-grow">
            <label class="block text-lg mb-1 font-medium text-white">{{ $t('accountSettings.anki.keyFieldLabel') }}</label>
            <select v-model="modelKey"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
              <option :value="null">{{ $t('accountSettings.anki.selectKeyField') }}</option>
              <option v-for="(option, index) in fieldOptions" :key="index" :value="option.key">
                {{ option.key }}
              </option>
            </select>
          </div>
        </div>
      </div>


      <div class="border rounded-lg overflow-hidden dark:border-modal-border">
        <table class="min-w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
          <thead>
            <tr class="divide-x bg-input-background divide-gray-200 dark:divide-white/30">
              <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.anki.fieldColumn') }}</th>
              <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.anki.contentColumn') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-white/20">
            <tr class="divide-x divide-gray-200 dark:divide-white/20" v-for="(item, index) in fieldOptions">
              <td
                class="w-6/12 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                {{ item.key }}
              </td>
              <td class="whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                <div class=" border my-3 mx-2 rounded-lg dark:bg-input-background dark:border-white/20">
                  <div class="w-full flex justify-between items-center gap-x-1">
                    <div class="grow py-1 px-3">
                      <input v-model="item.value"
                        class="w-full p-0 bg-transparent border-0 text-gray-800 focus:ring-0 dark:text-white"
                        type="text" />
                    </div>
                    <div class="flex flex-col divide-y text-left border-s border-s-neutral-600">
                      <div>
                        <SearchDropdownContainer dropdownId="hs-dropdown-with-header">
                          <template #default>
                            <SearchDropdownMainButton dropdownId="hs-dropdown-with-header">
                              <UiBaseIcon />
                            </SearchDropdownMainButton>
                          </template>
                          <template #content>
                            <SearchDropdownContent>
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{video}')"
                                :text="$t('searchpage.main.buttons.video')" :iconPath="mdiVideo" />
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{image}')"
                                :text="$t('searchpage.main.buttons.image')" :iconPath="mdiImage" />
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{sentence-audio}')"
                                :text="$t('searchpage.main.buttons.audio')" :iconPath="mdiVolumeHigh" />
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{sentence-info}')"
                                :text="$t('searchpage.main.buttons.info')" :iconPath="mdiText" />
                              <div
                                class="py-3 flex items-center text-sm text-gray-800 before:flex-1 before:border-t before:border-gray-200 after:flex-1 after:border-t after:border-gray-200 dark:text-white dark:before:border-neutral-600 dark:after:border-neutral-600">
                              </div>
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{sentence-jp}')"
                                :text="$t('searchpage.main.buttons.jpsentence')" :iconPath="mdiText" />
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{sentence-en}')"
                                :text="$t('searchpage.main.buttons.ensentence')" :iconPath="mdiText" />
                              <SearchDropdownItem @click="setKeyValueField(item.key, '{sentence-es}')"
                                :text="$t('searchpage.main.buttons.essentence')" :iconPath="mdiText" />
                            </SearchDropdownContent>
                          </template>
                        </SearchDropdownContainer>
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
              <h1 class="mt-3 text-lg text-gray-800 dark:text-white">{{ $t('accountSettings.anki.noFieldsFound') }}</h1>
              <p class="mt-2 text-gray-500 dark:text-gray-400">
                {{ $t('accountSettings.anki.noFieldsMessage') }}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Advanced Settings -->
    <div class="dark:bg-card-background p-6 mx-auto rounded-lg shadow-md">
      <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.anki.advancedSettings') }}</h3>
      <div class="border-b pt-4 border-white/10" />


      <!-- Anki Connect Address -->
      <div class="mt-4">
        <div class="gap-4 lg:gap-8 mb-5">
          <div class="flex-grow flex flex-row">
            <label class="block text-sm mb-1 pr-5 font-medium text-white">{{ $t('accountSettings.anki.serverAddressLabel') }}</label>
            <input v-model="ankiconnectAddress"
              class="w-full resize-none p-3 text-sm text-gray-900 border-1 border-gray-300 rounded-lg dark:bg-input-background dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-gray-500 dark:focus:border-gray-500">
            </input>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
