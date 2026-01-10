<script setup lang="ts">
import {
    mdiPlus,
    mdiCheckBold
} from '@mdi/js'

const auth_store = userStore()
const api_store = apiStore()
let isLoading = ref(false)
let isError = ref(false)
let isSuccess = ref(false)
let fieldOptions = {
    keys: [],
    quota: {
        quotaUsed: 0,
        quotaLimit: 2500,
    },
}
let generatedApiKey = ref(null);
let deactivatedApiKey = ref(null);
let quotaPercentage = 0;

// Modal state
const modalKeyName = ref('')

const openCreateModal = () => {
    modalKeyName.value = ''
    HSOverlay.open("#hs-vertically-centered-scrollable-createapikey-modal");
}

const closeCreateModal = () => {
    HSOverlay.close("#hs-vertically-centered-scrollable-createapikey-modal");
}

const handleBackdropClick = (event: MouseEvent) => {
    // Only close if clicking directly on the backdrop (not on modal content)
    if (event.target === event.currentTarget) {
        closeCreateModal();
    }
}

// Cleanup modal state when navigating away
onBeforeUnmount(() => {
    const modal = document.querySelector("#hs-vertically-centered-scrollable-createapikey-modal");
    if (modal && !modal.classList.contains('hidden')) {
        HSOverlay.close("#hs-vertically-centered-scrollable-createapikey-modal");
    }
})

const confirmCreateApiKey = async () => {
    if (!modalKeyName.value) {
        return
    }

    isLoading.value = true;
    isError.value = false;
    isSuccess.value = false;
    generatedApiKey.value = null;

    try {
        const response = await api_store.createApiKeyGeneral(modalKeyName.value);
        if (response && response.key) {
            generatedApiKey.value = response.key;
            isSuccess.value = true;
            closeCreateModal()
            await refreshApiKeys()
        } else {
            isError.value = true;
        }
    } catch (error) {
        isError.value = true;
        console.error(error);
    } finally {
        isLoading.value = false;
    }
}

const deactivateApiKey = async (item) => {
  try {
    isLoading.value = true;

    await api_store.deactivateApiKey(item.id);
    isSuccess.value = true;
    isLoading.value = false;
    deactivatedApiKey.value = true;
    await refreshApiKeys()

  } catch (error) {
    isError.value = true;
    console.error(error)

  } finally {
    isLoading.value = false;
  }
}

const refreshApiKeys = async () => {
    isError.value = false
    isSuccess.value = false
    isLoading.value = true
    try {
        const response = await api_store.getApiKeysByUser()
        fieldOptions = response ?? {
            keys: [],
            quota: {
                quotaUsed: 0,
                quotaLimit: 2500,
            },
        }
        fieldOptions.keys = (fieldOptions.keys ?? []).filter((key) => key.isActive);

        if (response?.status == 404) {
            isSuccess.value = false
        } else {
            isSuccess.value = true
        }
      const quotaUsed = fieldOptions.quota?.quotaUsed || 0;
      const quotaLimit = Number(fieldOptions.quota?.quotaLimit || 1);
      quotaPercentage = (quotaUsed / Math.max(1, quotaLimit)) * 100;

    } catch (error) {
        isError.value = true
        console.error(error)
    } finally {
        isLoading.value = false
    }
}

onMounted(async () => {
    await auth_store.getBasicInfo();
    await refreshApiKeys();
})



</script>

<template>
    <!-- Card -->
    <div class="bg-card-background p-6 mx-auto rounded-lg shadow-md">
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.developer.apiUsageTitle') }}</h3>
        <div class="border-b pt-4 border-white/10" />
        <div class="mt-4">
            <!-- Progress -->
            <div class="flex items-center gap-x-3 whitespace-nowrap">
                <div class="flex w-full h-6 bg-gray-200 rounded-lg overflow-hidden dark:bg-neutral-600" role="progressbar"
                    aria-valuenow="25" aria-valuemin="0" aria-valuemax="100">
                    <div class="flex flex-col justify-center overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-gray-300"
                        :style="{ width: quotaPercentage + '%' }"></div>
                </div>
                <div class="w-8 items-center align-middle text-center flex">
                    <span class="text-sm text-gray-800 dark:text-white">{{ quotaPercentage.toFixed(0) }}%</span>
                </div>
            </div>
            <!-- End Progress -->
        </div>
        <p class="mt-3 text-gray-300">{{ $t('accountSettings.developer.apiUsageRemaining', {
          used: fieldOptions.quota?.quotaUsed,
          limit: fieldOptions.quota?.quotaLimit
        }) }}</p>
    </div>

    <!-- Card -->
    <div class="bg-card-background p-6 my-6 mx-auto rounded-lg shadow-md">
        <div class="flex items-center">
            <div class="flex flex-col">
                <h3 class="text-lg text-white/90 tracking-wide font-semibold">{{ $t('accountSettings.developer.apiKeyManagement') }}</h3>
            </div>
            <div class="ml-auto">
                <button
                    class="bg-button-primary-main hover:bg-button-primary-hover text-white font-bold py-2 px-4 rounded" @click="openCreateModal">
                    <UiBaseIcon display="inline" :path="mdiPlus" fill="#DDDF" w="w-5" h="h-5" size="20"/>
                    {{ $t('accountSettings.developer.addApiKey') }}
                </button>
            </div>
        </div>
        <div v-if="generatedApiKey" role="alert"
            class="rounded border-s-4 mt-2 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
            <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20" />
                <strong class="block font-medium">{{ $t('accountSettings.developer.keyCreated') }}: {{ generatedApiKey}}</strong>
            </div>
                <p class="mt-2 text-sm text-green-700 dark:text-green-200">
                  {{$t('accountSettings.developer.keyCreatedMessage', { key: generatedApiKey }) }}
                </p>
            </div>

        <div v-if="deactivatedApiKey" role="alert"
            class="rounded border-s-4 mt-2 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900">
            <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                <UiBaseIcon :path="mdiCheckBold" size="20" />
                <strong class="block font-medium">{{ $t('accountSettings.developer.keyDeactivated') }}</strong>
            </div>
        </div>
        
        <div class="border-b pt-4 border-white/10" />

        <div class="mt-6">
            <div class="border rounded-lg overflow-hidden dark:border-modal-border">
                <table class="min-w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
                    <thead>
                        <tr class="divide-x bg-input-background divide-gray-200 dark:divide-white/30">
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.name') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.key') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.permissions') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.createdAt') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">{{ $t('accountSettings.developer.tableHeaders.status') }}</th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase"></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/20">
                        <tr class="divide-x divide-gray-200 dark:divide-white/20"
                            v-for="(item, index) in fieldOptions.keys">
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ item.name }}
                            </td>
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ item.hint }}
                            </td>
                            <td
                                class="w-4/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <div class="flex flex-col items-center justify-center w-full gap-y-2">
                                    <div class="inline-flex flex-wrap justify-center gap-2 w-full">

                                        <span v-for="(permission, index) in item?.permissions" :key="index"
                                            class="py-1 px-1.5 inline-flex items-center gap-x-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full dark:bg-blue-500/10 dark:text-blue-500">
                                            {{ permission.name }}
                                        </span>
                                    </div>
                                </div>
                            </td>
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                              <!-- For a while some db items didn't have createdAt date, so as a placeholder we show this date -->
                              {{ new Date(item.createdAt || '2025-03-01').toISOString().split('T')[0].replaceAll('-', '/') }}
                            </td>

                            <td
                                class="w-1/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <span v-if="!item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/50 dark:text-white/90 border border-gray-700">{{ $t('accountSettings.developer.statusInactive') }}
                                </span>
                                <span v-if="item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-green-500/50 dark:text-white/90 border border-gray-700">{{ $t('accountSettings.developer.statusActive') }}
                                </span>
                            </td>
                            <td
                                class="w-2/12 py-4 align-middle whitespace-nowrap text-base px-2 font-medium text-gray-800 dark:text-gray-200 ">
                                <div class="flex justify-center items-center h-full">
                                    <div class="hs-dropdown relative mb-2 mx-auto">
                                        <button id="hs-dropdown-with-title" type="button"
                                            class="border-transparent dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-lg border font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800">
                                            <svg class="hs-dropdown-open:rotate-180 w-5 h-5 rotate-180 fill-white text-gray-300"
                                                viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path
                                                    d="M14 5C14 6.10457 13.1046 7 12 7C10.8954 7 10 6.10457 10 5C10 3.89543 10.8954 3 12 3C13.1046 3 14 3.89543 14 5Z" />
                                                <path
                                                    d="M14 12C14 13.1046 13.1046 14 12 14C10.8954 14 10 13.1046 10 12C10 10.8954 10.8954 10 12 10C13.1046 10 14 10.8954 14 12Z" />
                                                <path
                                                    d="M12 21C13.1046 21 14 20.1046 14 19C14 17.8954 13.1046 17 12 17C10.8954 17 10 17.8954 10 19C10 20.1046 10.8954 21 12 21Z" />
                                            </svg>
                                        </button>

                                        <div class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                                            aria-labelledby="hs-dropdown-with-title">
                                            <div class="py-2 first:pt-0 last:pb-0">
                                                <span class="block py-2 px-3 text-xs font-medium item uppercase text-gray-400 dark:text-gray-500">
                                                    {{ $t('accountSettings.developer.options') }}
                                                </span>
                                                <a class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-redalert dark:hover:text-gray-300"
                                                    @click="deactivateApiKey(item)">
                                                    <svg xmlns="http://www.w3.org/2000/svg"
                                                        xmlns:xlink="http://www.w3.org/1999/xlink" width="20"
                                                        height="20" class="fill-white" version="1.1" id="Layer_1"
                                                        viewBox="0 0 512 512">
                                                        <g>
                                                            <g>
                                                                <path
                                                                    d="M505.403,406.394L295.389,58.102c-8.274-13.721-23.367-22.245-39.39-22.245c-16.023,0-31.116,8.524-39.391,22.246    L6.595,406.394c-8.551,14.182-8.804,31.95-0.661,46.37c8.145,14.42,23.491,23.378,40.051,23.378h420.028    c16.56,0,31.907-8.958,40.052-23.379C514.208,438.342,513.955,420.574,505.403,406.394z M477.039,436.372    c-2.242,3.969-6.467,6.436-11.026,6.436H45.985c-4.559,0-8.784-2.466-11.025-6.435c-2.242-3.97-2.172-8.862,0.181-12.765    L245.156,75.316c2.278-3.777,6.433-6.124,10.844-6.124c4.41,0,8.565,2.347,10.843,6.124l210.013,348.292    C479.211,427.512,479.281,432.403,477.039,436.372z" />
                                                            </g>
                                                        </g>
                                                        <g>
                                                            <g>
                                                                <path
                                                                    d="M256.154,173.005c-12.68,0-22.576,6.804-22.576,18.866c0,36.802,4.329,89.686,4.329,126.489    c0.001,9.587,8.352,13.607,18.248,13.607c7.422,0,17.937-4.02,17.937-13.607c0-36.802,4.329-89.686,4.329-126.489    C278.421,179.81,268.216,173.005,256.154,173.005z" />
                                                            </g>
                                                        </g>
                                                        <g>
                                                            <g>
                                                                <path
                                                                    d="M256.465,353.306c-13.607,0-23.814,10.824-23.814,23.814c0,12.68,10.206,23.814,23.814,23.814    c12.68,0,23.505-11.134,23.505-23.814C279.97,364.13,269.144,353.306,256.465,353.306z" />
                                                            </g>
                                                        </g>
                                                    </svg>
                                                    {{ $t('accountSettings.developer.deactivate') }}
                                                </a>
                                                <!--
                                                <a @click="currentSentence = sentence"
                                                    data-hs-overlay="#hs-vertically-centered-scrollable-editsentencemodal"
                                                    type="button"
                                                    class="flex items-center w-full cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                                                    <UiBaseIcon display="inline-block" vertical-align="top"
                                                        :path="mdiPencilOutline" fill="#DDDF" w="w-5" h="h-5" size="20"
                                                        class="text-center" />
                                                    Cambiar nombre
                                                </a>
                                                -->
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <section v-if="isLoading" class="container border-sgray2 rounded-xl px-4 mx-auto">
                    <div class="flex items-center my-6 text-center rounded-lg ">
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
                <section v-else-if="fieldOptions.keys.length === 0 && !isLoading" class="rounded-xl mx-auto">
                    <div class="flex items-center text-center h-96 dark:border-gray-700 bg-sgrayhover">
                        <div class="flex flex-col w-full max-w-sm px-4 mx-auto">
                            <div class="p-3 mx-auto text-sred bg-blue-100 rounded-full dark:bg-sgray">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                </svg>
                            </div>
                            <h1 class="mt-3 text-lg text-gray-800 dark:text-white">{{ $t('accountSettings.developer.noKeysFound') }}</h1>
                            <p class="mt-2 text-gray-500 dark:text-gray-400">
                                {{ $t('accountSettings.developer.noKeysMessage') }}
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>

    <!-- Create API Key Modal -->
    <div id="hs-vertically-centered-scrollable-createapikey-modal"
        class="hs-overlay hs-overlay-backdrop-open:bg-neutral-900/40 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
        @click="handleBackdropClick">
        <div
            class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all sm:max-w-lg m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
            @click="handleBackdropClick"
        >
            <div
                class="max-h-full flex flex-col bg-white border shadow-sm rounded-xl dark:bg-modal-background dark:border-modal-border w-full"
            >
                <div
                    class="flex justify-between items-center py-3 px-4 border-b dark:border-modal-border"
                >
                    <h3 class="font-bold text-gray-800 dark:text-gray-200">{{ $t('accountSettings.developer.createApiKeyModal.title') }}</h3>
                    <button
                        type="button"
                        class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
                        data-hs-overlay="#hs-vertically-centered-scrollable-createapikey-modal"
                    >
                        <span class="sr-only">Close</span>
                        <svg
                            class="w-3.5 h-3.5"
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M0.772004 0.772004C0.907186 0.636856 1.08918 0.560669 1.279 0.560669C1.46882 0.560669 1.65081 0.636856 1.786 0.772004L6.228 5.21401C6.36315 5.34919 6.43933 5.53119 6.43933 5.72101C6.43933 5.91082 6.36315 6.09282 6.228 6.22801C6.09282 6.36315 5.91082 6.43933 5.721 6.43933C5.53119 6.43933 5.34919 6.36315 5.214 6.22801L0.772004 1.786C0.636856 1.65081 0.560669 1.46882 0.560669 1.279C0.560669 1.08918 0.636856 0.907186 0.772004 0.772004Z"
                                fill="currentColor"
                            />
                            <path
                                d="M6.228 0.772004C6.36315 0.907186 6.43933 1.08918 6.43933 1.279C6.43933 1.46882 6.36315 1.65081 6.228 1.786L1.786 6.22801C1.65081 6.36315 1.46882 6.43933 1.279 6.43933C1.08918 6.43933 0.907186 6.36315 0.772004 6.22801C0.636856 6.09282 0.560669 5.91082 0.560669 5.72101C0.560669 5.53119 0.636856 5.34919 0.772004 5.21401L5.214 0.772004C5.34919 0.636856 5.53119 0.560669 5.721 0.560669C5.91082 0.560669 6.09282 0.636856 6.228 0.772004Z"
                                fill="currentColor"
                            />
                        </svg>
                    </button>
                </div>
                <div class="overflow-y-auto p-4">
                    <div class="flex flex-col gap-4">
                        <!-- Name input -->
                        <div>
                            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {{ $t('accountSettings.developer.createApiKeyModal.nameLabel') }}
                            </label>
                            <input
                                v-model="modalKeyName"
                                type="text"
                                class="w-full px-3 py-2 border rounded-lg border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-modal-input dark:border-white/5 dark:text-white"
                                :placeholder="$t('accountSettings.developer.createApiKeyModal.namePlaceholder')"
                            />
                        </div>

                    </div>
                </div>
                <div
                    class="flex justify-end items-center gap-2 py-3 px-4 border-t dark:border-modal-border"
                >
                    <button
                        type="button"
                        class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        @click="confirmCreateApiKey"
                        :disabled="!modalKeyName || isLoading"
                    >
                        {{ $t('accountSettings.developer.createApiKeyModal.create') }}
                    </button>
                </div>
            </div>
        </div>
    </div>

</template>
<style></style>
