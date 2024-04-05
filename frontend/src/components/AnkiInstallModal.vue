<script setup>
import { ref, watch, nextTick, onMounted } from 'vue'
import { ankiStore } from '../stores/anki'

// Configuración de lenguaje
import { useI18n } from 'vue-i18n'
const { t, locale } = useI18n()

const store = ankiStore()

let isError = ref(false)
let isLoading = ref(false)
let isSuccess = ref(false)

const testConnection = async () => {
  isError.value = false
  isSuccess.value = false
  isLoading.value = true

  try {
    await store.loadAnkiData()
    isSuccess.value = true
  } catch (error) {
    isError.value = true
    console.error(error)
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div
    id="hs-vertically-centered-scrollable-ankiinstall"
    class="hs-overlay-open:mt-7 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div
        class="max-h-full l flex flex-col bg-white border shadow-sm rounded-xl dark:bg-bgcolorcontext dark:border-sgray dark:shadow-slate-700/[.7]"
      >
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-sgray2">
          <h3 class="font-bold text-gray-800 dark:text-white">Integración con Anki</h3>
          <button
            type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-ankiinstall"
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
                d="M0.258206 1.00652C0.351976 0.912791 0.479126 0.860131 0.611706 0.860131C0.744296 0.860131 0.871447 0.912791 0.965207 1.00652L3.61171 3.65302L6.25822 1.00652C6.30432 0.958771 6.35952 0.920671 6.42052 0.894471C6.48152 0.868271 6.54712 0.854471 6.61352 0.853901C6.67992 0.853321 6.74572 0.865971 6.80722 0.891111C6.86862 0.916251 6.92442 0.953381 6.97142 1.00032C7.01832 1.04727 7.05552 1.1031 7.08062 1.16454C7.10572 1.22599 7.11842 1.29183 7.11782 1.35822C7.11722 1.42461 7.10342 1.49022 7.07722 1.55122C7.05102 1.61222 7.01292 1.6674 6.96522 1.71352L4.31871 4.36002L6.96522 7.00648C7.05632 7.10078 7.10672 7.22708 7.10552 7.35818C7.10442 7.48928 7.05182 7.61468 6.95912 7.70738C6.86642 7.80018 6.74102 7.85268 6.60992 7.85388C6.47882 7.85498 6.35252 7.80458 6.25822 7.71348L3.61171 5.06702L0.965207 7.71348C0.870907 7.80458 0.744606 7.85498 0.613506 7.85388C0.482406 7.85268 0.357007 7.80018 0.264297 7.70738C0.171597 7.61468 0.119017 7.48928 0.117877 7.35818C0.116737 7.22708 0.167126 7.10078 0.258206 7.00648L2.90471 4.36002L0.258206 1.71352C0.164476 1.61976 0.111816 1.4926 0.111816 1.36002C0.111816 1.22744 0.164476 1.10028 0.258206 1.00652Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <div class="overflow-y-auto">
          <div class="flex flex-row mx-auto">
            <div class="container w-100 sm:mx-4 mx-auto flex flex-col">
              <div class="p-6 space-y-6">
                <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
                  Para poder integrar Anki con NadeDB debe instalar una extensión en su navegador para permitir la
                  comunicación entre ambas aplicaciones. Seleccione el navegador que está utilizando.
                  <br />
                </p>

                <div class="mt-4">
                  <table class="min-w-full divide-y bg-sgray2 divide-gray-200 dark:divide-white/30">
                    <thead>
                      <tr class="divide-x divide-gray-200 dark:divide-white/30">
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          Chromium
                        </th>
                        <th scope="col" class="py-3 text-center text-xs font-medium text-white/60 uppercase">
                          Firefox
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200 dark:divide-white/30">
                      <tr>
                        <td class="p-4">
                          <a href="https://chromewebstore.google.com/detail/nadedb-export-tool/gpaooahlmepjgfkddhfbebeklmjgopoo">
                            <img src="../assets/chrome.png" alt="Chrome" class="mx-auto h-16" />
                          </a>
                        </td>
                        <td class="p-4">
                          <img src="../assets/firefox.png" alt="Firefox" class="mx-auto h-16" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p class="text-base leading-relaxed text-gray-500 dark:text-gray-400">
                  A continuación, podrá verificar si la extensión funciona correctamente:
                  <br />
                </p>
                <button
                  type="button"
                  class="py-3.5 duration-300 px-4 mb-4 w-full inline-flex justify-center items-center gap-2 border font-medium bg-white shadow-sm align-middle dark:hover:bg-sgrayhover focus:ring-blue-600 transition-all text-sm text-gray-900 rounded-lg focus:border-red-500 dark:bg-sgray2 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
                  @click="testConnection"
                >
                  Probar Conexión con Anki
                </button>

                <div>
                  <div
                    v-if="isLoading"
                    role="alert"
                    class="rounded border-s-4 border-blue-500 bg-blue-50 p-4 dark:border-blue-600 dark:bg-blue-900"
                  >
                    <div class="flex items-center gap-2 text-blue-800 dark:text-blue-100">
                      <div role="status">
                        <svg
                          aria-hidden="true"
                          class="inline w-5 h-5 text-gray-200 animate-spin dark:text-gray-400 fill-gray-500 dark:fill-gray-200"
                          viewBox="0 0 100 101"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                            fill="currentColor"
                          />
                          <path
                            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                            fill="currentFill"
                          />
                        </svg>
                        <span class="sr-only">Loading...</span>
                      </div>
                      <strong class="block font-medium">Cargando...</strong>
                    </div>
                    <p class="mt-2 text-sm text-blue-700 dark:text-blue-200">
                      Por favor, espere mientras se establece la conexión.
                    </p>
                  </div>

                  <div
                    v-if="isSuccess"
                    role="alert"
                    class="rounded border-s-4 border-green-500 bg-green-50 p-4 dark:border-green-600 dark:bg-green-900"
                  >
                    <div class="flex items-center gap-2 text-green-800 dark:text-green-100">
                      <strong class="block font-medium">Éxito</strong>
                    </div>
                    <p class="mt-2 text-sm text-green-700 dark:text-green-200">
                      La conexión con Anki se ha establecido con éxito.
                    </p>
                  </div>

                  <div
                    v-if="isError"
                    role="alert"
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
                    </p>
                    <ol class="pl-5 text-sm dark:text-red-200 list-disc">
                      <li>
                        Verifique que la aplicación de Anki este abierta y el addon
                        <a class="underline text-blue-400" href="https://ankiweb.net/shared/info/2055492159"
                          >Ankiconnect</a
                        >
                        instalado.
                      </li>
                      <li>
                        Verifique que "https://db.brigadasos.xyz" este en el webCorsOriginList de las configuraciones de
                        AnkiConnect.
                      </li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-sgray2">
          <button
            type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-sgray2 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-ankiinstall"
          >
            {{ t('reportModal.close') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
