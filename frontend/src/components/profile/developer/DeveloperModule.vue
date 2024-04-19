<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { apiStore } from '../../../stores/api'
import BaseIcon from '../../minimal/BaseIcon.vue'
import {
    mdiPencilOutline,
    mdiPlus
} from '@mdi/js'

const api_store = apiStore()

let isLoading = ref(false)
let isError = ref(false)
let isSuccess = ref(false)
let fieldOptions = []

onMounted(async () => {
    isError.value = false
    isSuccess.value = false
    isLoading.value = true
    try {
        let response = await api_store.getApiKeysByUser()
        fieldOptions = await response.json()
        if (response.status == 404) {
            isSuccess.value = false
        } else {
            isSuccess.value = true
        }

    } catch (error) {
        isError.value = true
        console.error(error)
    } finally {
        isLoading.value = false
    }
})

const quotaPercentage = computed(() => {
    const quotaUsed = fieldOptions.quota?.quotaUsed || 0;
    const quotaLimit = fieldOptions.quota?.quotaLimit || 1;
    return (quotaUsed / quotaLimit) * 100;
});


</script>

<template>
    <!-- Card -->
    <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">Consumo API</h3>
        <div class="border-b pt-4 border-white/10" />
        <div class="mt-4">
            <!-- Progress -->
            <div class="flex items-center gap-x-3 whitespace-nowrap">
                <div class="flex w-full h-6 bg-gray-200 rounded-lg overflow-hidden dark:bg-graypalid" role="progressbar"
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
        <p class="mt-3 text-gray-300">Peticiones restantes: {{ fieldOptions.quota?.quotaUsed }} / {{
                            fieldOptions.quota?.quotaLimit == 'NO_LIMIT' ? 'Ilimitado' : fieldOptions.quota?.quotaLimit }}</p>
    </div>

    <!-- Card -->
    <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">

        <div class="flex items-center">
            <div class="flex flex-col">
                <h3 class="text-lg text-white/90 tracking-wide font-semibold">Gestión de llaves API</h3>
            </div>
            <div class="ml-auto">
                <button
                    class="bg-graypalid flex items-center text-center hover:bg-graypalid/60 text-white font-bold py-2 pl-4  pr-6 rounded">
                    <BaseIcon display="inline" :path="mdiPlus" fill="#DDDF" w="w-5" h="h-5" size="20"
                        class="text-center flex mr-2 " />
                    <div class="align-middle mb-0.5 flex text-center items-centere">
                        Añadir llave API
                    </div>

                </button>
            </div>
        </div>

        <div class="border-b pt-4 border-white/10" />

        <div class="mt-6">
            <div class="border rounded-lg overflow-hidden dark:border-sgray">
                <table class="min-w-full divide-y bg-graypalid/20 divide-gray-200 dark:divide-white/30">
                    <thead>
                        <tr class="divide-x bg-sgray divide-gray-200 dark:divide-white/30 text-lg font-semibold">
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Nombre
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                                Clave
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                                Permisos
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                                Creación
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Estado
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                            </th>
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
                                            class="py-1 px-1.5 inline-flex items-center gap-x-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full dark:bg-teal-500/10 dark:text-teal-500">
                                            {{ permission.name }}
                                        </span>
                                    </div>
                                </div>
                            </td>
                            <td
                                class="w-2/12 py-4 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ new Date(item.createdAt).toISOString().split('T')[0].replaceAll('-', '/') }}
                            </td>

                            <td
                                class="w-1/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <span v-if="!item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/50 dark:text-white/90 border border-gray-700">Inactiva
                                </span>
                                <span v-if="item.isActive"
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-green-500/50 dark:text-white/90 border border-gray-700">Activa
                                </span>
                            </td>
                            <td
                                class="w-2/12 py-4 align-middle whitespace-nowrap text-base px-2 font-medium text-gray-800 dark:text-gray-200 ">
                                <div class="flex justify-center items-center h-full">
                                    <div class="hs-dropdown relative mb-2 mx-auto">
                                        <button id="hs-dropdown-with-title" type="button"
                                            class="border-transparent dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-lg border font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white dark:focus:ring-offset-gray-800">
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
                                                <span
                                                    class="block py-2 px-3 text-xs font-medium item uppercase text-gray-400 dark:text-gray-500">
                                                    Opciones
                                                </span>
                                                <a class="flex items-center cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-redalert dark:hover:text-gray-300"
                                                    @click="showModalReport(sentence)">
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
                                                    Desactivar
                                                </a>
                                                <a @click="currentSentence = sentence"
                                                    data-hs-overlay="#hs-vertically-centered-scrollable-editsentencemodal"
                                                    type="button"
                                                    class="flex items-center w-full cursor-pointer bg-sgray gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300">
                                                    <BaseIcon display="inline-block" vertical-align="top"
                                                        :path="mdiPencilOutline" fill="#DDDF" w="w-5" h="h-5" size="20"
                                                        class="text-center" />
                                                    Cambiar nombre
                                                </a>

                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <section v-if="isLoading" class="container border-sgray2 rounded-xl px-4 mx-auto">
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
                            <h1 class="mt-3 text-lg text-gray-800 dark:text-white">No se han encontrado llaves API</h1>
                            <p class="mt-2 text-gray-500 dark:text-gray-400">
                                ¡Crea una nueva para tus aplicaciones o proyectos!
                            </p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>

</template>
<style></style>