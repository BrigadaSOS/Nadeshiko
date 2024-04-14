<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import FileExplorer from './FileExplorer.vue'
import AccountModule from './account/AccountModule.vue'
import AnkiModule from './srs/AnkiModule.vue'

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

let fieldOptions = [{ key: 'test' }]
</script>

<template>
  <div class="bg-[#181a1b] p-10 text-white min-h-screen">
    <div class="w-9/12 mx-auto">
      <!-- Settings Header -->
      <div class="mb-4">
        <h1 class="text-3xl font-semibold">Ajustes</h1>
        <div class="mt-2">
          <nav
            class="pb-1 tabs-container flex space-x-1 overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-gray-100 [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-track]:bg-slate-700 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500"
            aria-label="Tabs"
            role="tablist"
          >
            <div id="tab-headers">
              <ul class="tab-titles">
                <li
                  type="button"
                  class="hs-tab-active:font-semibold hs-tab-active:border-blue-600 hs-tab-active:text-blue-600 py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-md whitespace-nowrap text-gray-500 focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none dark:text-white/90 active"
                  id="horizontal-scroll-tab-item-1"
                  data-hs-tab="#horizontal-scroll-tab-preview"
                  aria-controls="horizontal-scroll-tab-preview"
                  role="tab"
                >
                  Cuenta
                </li>
                <!--
                <li
                  type="button"
                  class="hs-tab-active:font-semibold hs-tab-active:border-blue-600 hs-tab-active:text-blue-600 py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-md whitespace-nowrap text-gray-500 focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none dark:text-white/90"
                  id="horizontal-scroll-tab-item-3"
                  data-hs-tab="#horizontal-scroll-tab-3"
                  aria-controls="horizontal-scroll-tab-3"
                  role="tab"
                >
                  Preferencias
                </li>-->
                <li
                  type="button"
                  class="hs-tab-active:font-semibold hs-tab-active:border-blue-600 hs-tab-active:text-blue-600 py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-md whitespace-nowrap text-gray-500 focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none dark:text-white/90"
                  id="horizontal-scroll-tab-item-2"
                  data-hs-tab="#horizontal-scroll-tab-2"
                  aria-controls="horizontal-scroll-tab-2"
                  role="tab"
                >
                  Anki
                </li>
                <!--
                <li
                  type="button"
                  class="hs-tab-active:font-semibold hs-tab-active:border-blue-600 hs-tab-active:text-blue-600 py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-md whitespace-nowrap text-gray-500 focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none dark:text-white/90"
                  id="horizontal-scroll-tab-item-5"
                  data-hs-tab="#horizontal-scroll-tab-5"
                  aria-controls="horizontal-scroll-tab-5"
                  role="tab"
                >
                  Explorador
                </li>
                -->
                <li
                  type="button"
                  class="hs-tab-active:font-semibold hs-tab-active:border-blue-600 hs-tab-active:text-blue-600 py-4 px-1 inline-flex items-center gap-x-2 border-b-2 border-transparent text-md whitespace-nowrap text-gray-500 focus:outline-none focus:text-blue-600 disabled:opacity-50 disabled:pointer-events-none dark:text-white/90"
                  id="horizontal-scroll-tab-item-4"
                  data-hs-tab="#horizontal-scroll-tab-4"
                  aria-controls="horizontal-scroll-tab-4"
                  role="tab"
                >
                  Desarrollador
                </li>
              </ul>
            </div>
          </nav>
        </div>
      </div>

      <div class="mt-3">
        <div id="horizontal-scroll-tab-preview" role="tabpanel" aria-labelledby="horizontal-scroll-tab-item-1">
          <AccountModule />
        </div>
        <div id="horizontal-scroll-tab-2" class="hidden" role="tabpanel" aria-labelledby="horizontal-scroll-tab-item-2">
          <AnkiModule />
        </div>
        <div id="horizontal-scroll-tab-4" class="hidden" role="tabpanel" aria-labelledby="horizontal-scroll-tab-item-4">
          <!-- Card -->
          <div class="bg-sgray2 p-6 my-6 mx-auto rounded-lg shadow-md">
            <h3 class="text-lg text-white/90 tracking-wide font-semibold">Consumo API</h3>
            <p class="text-gray-400">Mensual</p>
            <div class="border-b pt-4 border-white/10" />
            <div class="mt-4">
              <!-- Progress -->
              <div class="flex items-center gap-x-3 whitespace-nowrap">
                <div
                  class="flex w-full h-6 bg-gray-200 rounded-lg overflow-hidden dark:bg-graypalid"
                  role="progressbar"
                  aria-valuenow="25"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="flex flex-col justify-center overflow-hidden bg-blue-600 text-xs text-white text-center whitespace-nowrap transition duration-500 dark:bg-gray-300"
                    style="width: 35%"
                  ></div>
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
                    <tr class="divide-x bg-graypalid divide-gray-200 dark:divide-white/30">
                      <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Nombre</th>
                      <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                        Clave de API
                      </th>
                      <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">
                        Fecha de creación
                      </th>
                      <th scope="col" class="py-3 text-center text-xs font-medium text-white/90 uppercase">Estado</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-200 dark:divide-white/20">
                    <tr class="divide-x divide-gray-200 dark:divide-white/20" v-for="(item, index) in fieldOptions">
                      <td
                        class="w-3/12 py-4 whitespace-nowrap text-base text-center px-2 font-medium text-gray-800 dark:text-gray-200"
                      >
                        {{ item.key }}
                      </td>
                      <td
                        class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200"
                      >
                        dasdasd13123dasdasdx:fx
                      </td>
                      <td
                        class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200"
                      >
                        13/04/2024
                      </td>
                      <td
                        class="w-4/12 whitespace-nowrap text-center text-base px-2 font-medium text-gray-800 dark:text-gray-200"
                      >
                        <span
                          class="bg-gray-100 mb-1 text-gray-800 text-sm xxl:text-base xxm:text-2xl font-medium inline-flex items-center px-2.5 py-0.5 rounded mr-2 dark:bg-sred/50 dark:text-white/90 border border-gray-700"
                          >Inactiva
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <!--
        <div id="horizontal-scroll-tab-5" class="hidden" role="tabpanel" aria-labelledby="horizontal-scroll-tab-item-5">
          <div class="explorer" v-if="user?.roles?.includes(1)">
            <FileExplorer />
          </div>
        </div>
        -->
      </div>
    </div>
  </div>
</template>
<style>
#tab-headers ul {
  margin: 0;
  padding: 0;
  display: flex;
  border-bottom: 1px solid #dddddd21;
}
#tab-headers ul li {
  list-style: none;
  padding: 1rem 1.25rem;
  position: relative;
  cursor: pointer;
}
#tab-headers ul li.active {
  color: rgb(251, 120, 120);
  font-weight: bold;
}

#tab-headers ul li.active:after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  height: 2px;
  width: 100%;
  background: rgb(251, 120, 120);
}
#active-tab,
#tab-headers {
  width: 100%;
}

#active-tab {
  padding: 0.75rem;
}
</style>
