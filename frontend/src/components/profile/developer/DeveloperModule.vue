<script setup>
import { ref, onMounted, watch, computed } from 'vue'

</script>

<template>
    <!-- Card -->
    <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
        <h3 class="text-lg text-white/90 tracking-wide font-semibold">Consumo API</h3>
        <p class="text-gray-400">Mensual</p>
        <div class="border-b pt-4 border-white/10" />
        <div class="mt-4">
            <!-- Progress -->
            <div class="flex items-center gap-x-3 whitespace-nowrap">
                <div class="flex w-full h-6 bg-gray-200 rounded-lg overflow-hidden dark:bg-graypalid" role="progressbar"
                    aria-valuenow="25" aria-valuemin="0" aria-valuemax="100">
                    <div class="flex flex-col justify-center overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-gray-300"
                        style="width: 35%"></div>
                </div>
                <div class="w-8 items-center align-middle text-center flex">
                    <span class="text-sm text-gray-800 dark:text-white">45%</span>
                </div>
            </div>
            <!-- End Progress -->
        </div>
        <p class="mt-3 text-gray-300">Cantidad disponible: 1700 / 5000 busquedas</p>
    </div>

    <!-- Card -->
    <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
        <div class="flex items-center">
            <div class="flex flex-col">
                <h3 class="text-lg text-white/90 tracking-wide font-semibold">Gestión de llaves API</h3>
                <div class="inline">
                    <p class="text-gray-400 inline">Consulte aquí la documentación de la API en está&nbsp;</p>
                    <a class="underline text-blue-400/95 underline-offset-4" href="www.google.com">página</a>
                </div>
            </div>
            <div class="ml-auto">
                <button class="bg-graypalid hover:bg-graypalid/60 text-white font-bold py-2 px-4 rounded">
                    Añadir llave API
                </button>
            </div>
        </div>

        <div class="border-b pt-4 border-white/10" />

        <div class="mt-4">
            <div class="border rounded-lg overflow-hidden dark:border-sgray2">
                <table class="min-w-full divide-y bg-sgray divide-gray-200 dark:divide-white/30">
                    <thead>
                        <tr class="divide-x bg-sgray2 divide-gray-200 dark:divide-white/30">
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Nombre
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                                Clave de API
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                                Fecha de creación
                            </th>
                            <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Estado
                            </th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/20">
                        <tr class="divide-x divide-gray-200 dark:divide-white/20" v-for="(item, index) in fieldOptions">
                            <td
                                class="w-3/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200">
                                {{ item.key }}
                            </td>
                            <td
                                class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                dasdasd13123dasdasdx:fx
                            </td>
                            <td
                                class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                13/04/2024
                            </td>
                            <td
                                class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200">
                                <span
                                    class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/50 dark:text-white/90 border border-gray-700">Inactiva
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>