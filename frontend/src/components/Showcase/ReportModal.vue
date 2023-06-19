<script setup>
import { ref, watch, nextTick } from 'vue'
const selectedOption = ref('')

const submitReport = () => {
  console.log(selectedOption.value)
}

</script>

<template>
  <div
    id="hs-vertically-centered-scrollable-modal2"
    class="hs-overlay-open:mt-7 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div
        class="max-h-full l flex flex-col bg-white border shadow-sm rounded-xl dark:bg-sgray dark:border-sgray dark:shadow-slate-700/[.7]"
      >
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-gray-700">
          <h3 class="font-bold text-gray-800 dark:text-white">Reportar un problema</h3>
          <button
            type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-modal2"
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
                  Las oraciones que se presentan en este sitio web están segmentadas con herramientas que procesan de
                  forma automática el contenido multimedia. Si bien, aunque pasan por un filtro de calidad, es posible
                  que en el proceso ciertas oraciones tengan problemas. <br />
                  <br />
                  Si encuentra algún problema, se lo agradecemos reportándolo mediante el formulario que se encuentra a
                  continuación.
                </p>

                <p class="text-xl text-gray-500 dark:text-gray-400 font-medium">¿Cuál es el problema?</p>
                <div class="flex items-center pl-4 border border-gray-200 rounded dark:border-gray-700">
                  <input
                    id="bordered-radio-1"
                    type="radio"
                    v-model="selectedOption"
                    value="1"
                    name="bordered-radio"
                    class="w-4 h-4 text-sred bg-gray-100 border-gray-300 focus:ring-sred dark:focus:ring-sred dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label
                    for="bordered-radio-1"
                    class="w-full py-4 ml-2 text-sm font-medium text-gray-900 dark:text-gray-300"
                    >El audio no corresponde a la oración.</label
                  >
                </div>
                <div class="flex items-center pl-4 border border-gray-200 rounded dark:border-gray-700">
                  <input
                    id="bordered-radio-2"
                    type="radio"
                    v-model="selectedOption"
                    value="2"
                    name="bordered-radio"
                    class="w-4 h-4 text-sred bg-gray-100 border-gray-300 focus:ring-sred dark:focus:ring-sred dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label
                    for="bordered-radio-2"
                    class="w-full py-4 ml-2 text-sm font-medium text-gray-900 dark:text-gray-300"
                    >El audio se encuentra desfasado con respecto a la oración.</label
                  >
                </div>
                <div class="flex items-center pl-4 border border-gray-200 rounded dark:border-gray-700">
                  <input
                    id="bordered-radio-3"
                    type="radio"
                    v-model="selectedOption"
                    value="3"
                    name="bordered-radio"
                    class="w-4 h-4 text-sred bg-gray-100 border-gray-300 focus:ring-sred dark:focus:ring-sred dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label
                    for="bordered-radio-3"
                    class="w-full py-4 ml-2 text-sm font-medium text-gray-900 dark:text-gray-300"
                    >La oración no tiene imagen o sonido.</label
                  >
                </div>
                <div class="flex items-center pl-4 border border-gray-200 rounded dark:border-gray-700">
                  <input
                    id="bordered-radio-4"
                    type="radio"
                    v-model="selectedOption"
                    value="4"
                    name="bordered-radio"
                    class="w-4 h-4 text-sred bg-gray-100 border-gray-300 focus:ring-sred dark:focus:ring-sred dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <label
                    for="bordered-radio-4"
                    class="w-full py-4 ml-2 text-sm font-medium text-gray-900 dark:text-gray-300"
                    >La imagen, oración, o audio no son apropiadas (NSFW).</label
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-gray-700">
          <button
            type="button"
            @click="submitReport"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-gray-700 text-gray-700 shadow-sm align-middle hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-gray-700 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-modal2"
          >
            Enviar reporte
          </button>
          <button
            type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-gray-700 text-gray-700 shadow-sm align-middle hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-gray-700 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-modal2"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
