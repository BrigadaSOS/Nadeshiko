<script setup lang="ts">
defineProps<{
  currentPage: number
  totalPages: number
  basePath: string
}>()

const getPageNumbers = (current: number, total: number) => {
  const pages: (number | string)[] = []
  const showEllipsisStart = current > 3
  const showEllipsisEnd = current < total - 2

  if (total <= 7) {
    for (let i = 1; i <= total; i++) {
      pages.push(i)
    }
  } else {
    pages.push(1)

    if (showEllipsisStart) {
      pages.push('...')
    }

    const start = Math.max(2, current - 1)
    const end = Math.min(total - 1, current + 1)

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }

    if (showEllipsisEnd) {
      pages.push('...')
    }

    pages.push(total)
  }

  return pages
}
</script>

<template>
  <nav class="flex justify-center items-center gap-2 mt-8" aria-label="Blog pagination">
    <NuxtLink
      v-if="currentPage > 1"
      :to="`${basePath}?page=${currentPage - 1}`"
      class="px-3 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
      aria-label="Previous page"
    >
      Previous
    </NuxtLink>

    <template v-for="page in getPageNumbers(currentPage, totalPages)" :key="page">
      <span v-if="page === '...'" class="px-2 py-2 text-gray-400">...</span>
      <NuxtLink
        v-else-if="page === currentPage"
        :to="`${basePath}?page=${page}`"
        class="px-3 py-2 text-sm font-bold text-white bg-button-primary-main rounded-lg"
        aria-current="page"
      >
        {{ page }}
      </NuxtLink>
      <NuxtLink
        v-else
        :to="`${basePath}?page=${page}`"
        class="px-3 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
      >
        {{ page }}
      </NuxtLink>
    </template>

    <NuxtLink
      v-if="currentPage < totalPages"
      :to="`${basePath}?page=${currentPage + 1}`"
      class="px-3 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
      aria-label="Next page"
    >
      Next
    </NuxtLink>
  </nav>
</template>
