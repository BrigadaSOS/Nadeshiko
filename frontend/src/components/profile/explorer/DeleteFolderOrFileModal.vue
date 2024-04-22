<script setup>
import { ref, watch, nextTick } from 'vue'
const props = defineProps({
  path: {
    type: Object,
    required: true
  }
})

import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const emits = defineEmits(['refresh-directorytree'])

const createFolder = async () => {
  let response = null

  try {
    response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + `jwt/files/deleteFolderOrFile`, {
      method: 'POST',
      mode: 'cors',
      withCredentials: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        directory: props.path,
      })
    })
    response = await response.json()
    if (response.status === 401) {
      return store.logout('La sesión ha expirado. Inicia sesión nuevamente.')
    }
    emits('refresh-directorytree')
  } catch (error) {
    console.log(error)
    return
  }
}
</script>

<template>
  <div
    id="hs-vertically-centered-scrollable-deletefolderorfile"
    class="hs-overlay-open:mt-7 hidden w-full h-full fixed top-0 left-0 z-[60] overflow-x-hidden overflow-y-auto"
  >
    <div
      class="justify-center hs-overlay-open:opacity-100 hs-overlay-open:duration-500 mt-0 opacity-0 ease-out transition-all lg:max-w-3xl m-3 sm:mx-auto h-[calc(100%-3.5rem)] min-h-[calc(100%-3.5rem)] flex items-center"
    >
      <div
        class="max-h-full l flex flex-col bg-white border shadow-sm rounded-xl dark:bg-bgcolorcontext dark:border-sgray dark:shadow-slate-700/[.7]"
      >
        <div class="flex justify-between items-center py-3 px-4 border-b dark:border-sgray2">
          <h3 class="font-bold text-gray-800 dark:text-white">Eliminar</h3>
          <button
            type="button"
            class="hs-dropdown-toggle inline-flex flex-shrink-0 justify-center items-center h-8 w-8 rounded-md text-gray-500 hover:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-white transition-all text-sm dark:focus:ring-gray-700 dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-deletefolderorfile"
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
              <div class="px-2 py-6 space-y-6">
                <div class="flex gap-x-4 md:gap-x-7">
                  <div class="grow">
                    <p class="text-white">¿Está seguro de eliminar <b>"{{ props.path }}"</b> de NadeDB?</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex justify-end items-center gap-x-2 py-3 px-4 border-t dark:border-sgray2">
          <button
            type="button"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sgray text-gray-700 shadow-sm align-middle hover:bg-sgrayhover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-sgray2 dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-deletefolderorfile"
          >
            Cancelar
          </button>
          <button
            type="button"
            @click="createFolder"
            class="hs-dropdown-toggle h-14 lg:h-12 py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md border font-medium bg-sred/60 text-gray-700 shadow-sm align-middle hover:bg-sred/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white focus:ring-blue-600 transition-all text-sm dark:border-none dark:text-white dark:hover:text-white dark:focus:ring-offset-gray-800"
            data-hs-overlay="#hs-vertically-centered-scrollable-deletefolderorfile"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
