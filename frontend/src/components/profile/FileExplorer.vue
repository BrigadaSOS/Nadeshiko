<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import BaseIcon from '../minimal/BaseIcon.vue'
import { mdiFolder, mdiFileOutline, mdiDotsVertical } from '@mdi/js'
import { userStore } from '../../stores/user'

const store = userStore()
let directoryTree = ref([])
let currentDirectory = ref('media')
const isNavigating = ref(false);

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
      type: 'directory'
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
  <ol class="flex items-center whitespace-nowrap pb-5 pt-2" aria-label="Breadcrumb">
    <li class="inline-flex items-center">
      <a
        class="flex items-center text-sm text-gray-300 hover:text-blue-600 focus:outline-none focus:text-blue-600 dark:focus:text-blue-500"
        href="#"
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
        class="flex items-center text-sm text-gray-300 hover:text-blue-600 focus:outline-none focus:text-blue-600 dark:focus:text-blue-500"
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
        class="divide-x divide-gray-200 dark:divide-white/20 hover:bg-sgray dark:hover:bg-sgray3"
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
          <button v-if="item.name !== '...'" class="hover:bg-white/25 rounded-full items-center text-center p-2">
            <BaseIcon display="flex" size="20" :path="mdiDotsVertical" fill="#DDDF" />
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
