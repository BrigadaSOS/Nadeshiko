<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import BaseIcon from '../minimal/BaseIcon.vue'
import {
  mdiFolder,
  mdiFileOutline,
  mdiDotsVertical,
  mdiFolderPlusOutline,
  mdiUpload,
  mdiTrashCanOutline,
  mdiArrowUpRightBold
} from '@mdi/js'
import { userStore } from '../../stores/user'
import CreateFolder from './explorer/CreateFolderModal.vue'
import DeleteFolderOrFile from './explorer/DeleteFolderOrFileModal.vue'

const store = userStore()
let directoryTree = ref([])
let currentDirectory = ref('media')
const isNavigating = ref(false)
let selectedItem = ref(null)

onMounted(async () => {
  await getDirectoryTree('media')
})
const delay = (ms) => new Promise((res) => setTimeout(res, ms))

const getDirectoryTree = async (directory) => {
  let response = null
  if (isNavigating.value === true) {
    return
  }
  isNavigating.value = true
  // await delay(2000)
  try {
    const params = new URLSearchParams({ directory }).toString()
    response = await fetch(import.meta.env.VITE_APP_BASE_URL_BACKEND + `files?${params}`, {
      method: 'GET',
      mode: 'cors',
      withCredentials: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    })
    response = await response.json()
    isNavigating.value = false

    if (response.status === 401) {
      return store.logout('La sesión ha expirado. Inicia sesión nuevamente.')
    }
  } catch (error) {
    console.log(error)
    isNavigating.value = false
    return
  }

  if (currentDirectory.value !== 'media') {
    response.unshift({
      name: '...',
      type: 'directory-up'
    })
  }
  directoryTree.value = response
}
watch(currentDirectory, (newDir) => {
  if (isNavigating.value === true) {
    return
  }
  getDirectoryTree(newDir)
})
const formatDate = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatSize = (size) => {
  const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024))
  return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i]
}

const navigate = (item) => {
  if (isNavigating.value === true) {
    return
  }
  if (item.name === '...') {
    const pathSegments = currentDirectory.value.split('/')
    pathSegments.pop()
    currentDirectory.value = pathSegments.join('/') || 'media/anime'
  } else if (item.type === 'directory') {
    currentDirectory.value += '/' + item.name
  }
}

const breadcrumbSegments = computed(() => {
  const segments = currentDirectory.value.split('/')
  return segments.filter((segment) => segment !== '')
})

const navigateToRoot = () => {
  currentDirectory.value = 'media'
}

const navigateToSegment = (segment) => {
  const index = breadcrumbSegments.value.indexOf(segment)
  if (index !== -1) {
    const newPath = breadcrumbSegments.value.slice(0, index + 1).join('/')
    currentDirectory.value = newPath
  }
}
</script>
<template>
  <ol class="flex items-center whitespace-nowrap pb-3 pt-2" aria-label="Breadcrumb">
    <li class="inline-flex items-center">
      <a
        class="flex cursor-pointer items-center text-base text-gray-300 hover:text-sred focus:outline-none focus:text-sred dark:focus:text-sred"
        @click.prevent="navigateToRoot"
      >
        Home
      </a>
      <div class="flex items-center text-gray-500">
        <svg
          class="flex-shrink-0 mx-2 overflow-visible h-4 w-4 text-gray-400 dark:text-neutral-600 dark:text-neutral-600"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </li>
    <li v-for="(segment, index) in breadcrumbSegments" :key="index" class="inline-flex items-center">
      <a
        class="flex items-center text-base text-gray-300 hover:text-sred focus:outline-none focus:text-blue-600 dark:focus:text-blue-500"
        href="#"
        @click.prevent="navigateToSegment(segment)"
      >
        {{ segment }}
      </a>

      <div class="flex items-center text-gray-500">
        <svg
          v-if="index < breadcrumbSegments.length - 1"
          class="flex-shrink-0 mx-2 overflow-visible h-4 w-4 text-gray-400 dark:text-neutral-600 dark:text-neutral-600"
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
    </li>
  </ol>

  <div class="flex">
    <div class="relative ml-auto inline-flex mb-3">
      <button
        data-hs-overlay="#hs-vertically-centered-scrollable-createfolder"
        type="button"
        class="dark:bg-sgray mr-2 outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white"
      >
        <BaseIcon display="flex" size="20" :path="mdiFolderPlusOutline" fill="#DDDF" />
        Nueva carpeta
      </button>
      <button
        data-hs-overlay="#hs-vertically-centered-scrollable-uploadfile"
        type="button"
        class="dark:bg-sgray outline-none dark:hover:bg-sgrayhover hs-dropdown-toggle py-3 px-4 inline-flex justify-center items-center gap-2 rounded-md font-medium bg-white text-gray-700 shadow-sm align-middle hover:bg-gray-50 transition-all text-sm xxl:text-base xxm:text-2xl dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-gray-300 dark:hover:text-white"
      >
        <BaseIcon display="flex" size="20" :path="mdiUpload" fill="#DDDF" />
        Subir archivo
      </button>
    </div>
  </div>

  <table class="min-w-full divide-y bg-gray-100 dark:bg-sgray2 divide-gray-200 dark:divide-white/30">
    <thead>
      <tr class="divide-x bg-gray-200 dark:bg-sgray divide-gray-200 dark:divide-white/30">
        <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">Nombre</th>
        <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">
          Fecha de creación
        </th>
        <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase">Tamaño</th>
        <th class="py-3 px-6 text-left text-xs font-medium text-gray-700 dark:text-white uppercase border-none"></th>
      </tr>
    </thead>
    <tbody class="bg-white dark:bg-sgray2 divide-y divide-gray-200 dark:divide-white/20">
      <tr
        class="divide-x group divide-gray-200 dark:divide-white/20 hover:bg-sgray dark:hover:bg-sgray3"
        v-for="(item, index) in directoryTree"
      >
        <td class="py-4 cursor-pointer px-6" @click="navigate(item)">
          <i v-if="item.type === 'file'">
            <BaseIcon display="inline-block" :path="mdiFileOutline" fill="#DDDF" />
            {{ item.name }}
          </i>
          <i v-else-if="item.type === 'directory'">
            <BaseIcon display="inline-block" :path="mdiFolder" fill="#DDDF" />
            {{ item.name }}
          </i>
          <i v-else-if="item.type === 'directory-up'">
            <BaseIcon display="inline-block" size="18" :path="mdiArrowUpRightBold" fill="#DDDF" />
            {{ item.name }}
          </i>
        </td>
        <td @click="navigate(item)" v-if="item.name !== '...'" class="py-4 cursor-pointer px-4">
          {{ formatDate(item.createdDate) }}
        </td>
        <td @click="navigate(item)" v-else class="py-4 cursor-pointer px-4"></td>

        <td @click="navigate(item)" v-if="item.name !== '...'" class="py-4 cursor-pointer px-4">
          {{ formatSize(item.size) }}
        </td>
        <td @click="navigate(item)" v-else class="py-4 cursor-pointer px-4"></td>
        <td class="pr-10 border-none text-right">
          <div>
            <div class="hs-dropdown relative inline-flex mb-2 mr-2">
              <button
                v-if="item.name !== '...'"
                id="hs-dropdown-with-title"
                type="button"
                class="hover:bg-white/25 hidden group-hover:flex rounded-full items-center text-center p-2 absolute right-0 top-1/2 transform -translate-y-1/2"
              >
                <BaseIcon display="flex" size="20" :path="mdiDotsVertical" fill="#DDDF" />
              </button>

              <div
                class="hs-dropdown-menu z-30 transition-[opacity,margin] duration hs-dropdown-open:opacity-100 opacity-0 hidden min-w-[15rem] bg-white shadow-md rounded-lg p-2 mt-2 divide-y divide-gray-200 dark:bg-sgray dark:divide-gray-700"
                aria-labelledby="hs-dropdown-with-title"
              >
                <div class="py-2 first:pt-0 last:pb-0">
                  <span
                    class="block py-2 px-3 text-xs text-left font-medium uppercase text-gray-400 dark:text-gray-500"
                  >
                    Opciones
                  </span>
                  <a
                    class="flex items-center cursor-pointer gap-x-3.5 py-2 px-3 rounded-md text-sm xxl:text-base xxm:text-2xl text-gray-800 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-sgrayhover dark:hover:text-gray-300"
                    data-hs-overlay="#hs-vertically-centered-scrollable-deletefolderorfile"
                    @click="
                      selectedItem =
                        item.type === 'file' ? currentDirectory + '/' + item.name : currentDirectory + '/' + item.name
                    "
                  >
                    <BaseIcon :path="mdiTrashCanOutline" w="w-5 md:w-5" h="h-5 md:h-5" size="20" class="" />
                    Eliminar
                  </a>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
  <CreateFolder :path="currentDirectory" @refresh-directorytree="getDirectoryTree(currentDirectory)"/>
  <DeleteFolderOrFile :path="selectedItem" @refresh-directorytree="getDirectoryTree(currentDirectory)" />
</template>
