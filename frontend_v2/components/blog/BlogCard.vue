<script setup lang="ts">
interface BlogPost {
  slug: string
  title: string
  description: string
  date: string | Date | null
  author?: string
  excerpt?: string
  tags?: string[]
  image?: string
  path?: string
  body?: any
}

const props = defineProps<{
  post: BlogPost
}>()

// Extract slug from path if not directly provided
const blogSlug = computed(() => {
  if (props.post.slug) return props.post.slug
  if (props.post.path) {
    // Remove locale prefix, /blog/ prefix, and .md extension
    return props.post.path
      .replace(/^\/[a-z]{2}\//, '') // Remove locale prefix like /en/
      .replace(/^blog\//, '') // Remove /blog/ prefix if present
      .replace(/\.md$/, '') // Remove .md extension
  }
  return ''
})

// Format the date for display
const formattedDate = computed(() => {
  const dateValue = props.post.date

  if (!dateValue) return null

  try {
    // Handle object dates (empty objects from serialization)
    if (typeof dateValue === 'object' && !Array.isArray(dateValue) && dateValue !== null) {
      const keys = Object.keys(dateValue)
      if (keys.length === 0) return null
    }

    const date = new Date(dateValue)
    if (isNaN(date.getTime())) return null

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return null
  }
})

// Get content preview - first ~500 words from body
const contentPreview = computed(() => {
  // First, try to get content from the body
  const body = props.post.body
  if (body && body.children && Array.isArray(body.children)) {
    // Extract text content from paragraph elements
    const paragraphs = body.children
      .filter((child: any) => child?.tag === 'p')
      .map((child: any) => {
        if (child.children && Array.isArray(child.children)) {
          return child.children
            .map((c: any) => c.value || '')
            .join('')
        }
        return ''
      })
      .filter(text => text.trim().length > 0)
      .join(' ')

    // Limit to approximately 500 words
    if (paragraphs) {
      const words = paragraphs.split(/\s+/)
      if (words.length > 500) {
        return words.slice(0, 500).join(' ') + '...'
      }
      return paragraphs
    }
  }

  // Fallback to excerpt or description
  return props.post.excerpt || props.post.description || ''
})
</script>

<template>
  <article class="mb-12 pb-10 border-b border-gray-800 last:border-0 hover:border-gray-700 transition-colors duration-200">
    <div class="flex flex-col">
      <!-- Title -->
      <NuxtLink :to="`/blog/${blogSlug}`" class="group block">
        <h2 class="text-2xl font-bold text-white group-hover:text-[#ef5552] transition-colors duration-200">
          {{ post.title }}
        </h2>
      </NuxtLink>

      <!-- Meta info -->
      <div class="flex items-center gap-4 text-sm mt-3 mb-5">
        <span v-if="formattedDate" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800/50 border border-gray-700">
          <svg class="w-4 h-4 text-[#ef5552]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="text-gray-300">{{ formattedDate }}</span>
        </span>
        <span v-if="post.author" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-800/50 border border-gray-700">
          <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span class="text-gray-300">{{ post.author }}</span>
        </span>
        <span v-if="post.tags && post.tags.length" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ef5552]/10 border border-[#ef5552]/30">
          <svg class="w-4 h-4 text-[#ef5552]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <span class="text-[#ef5552]">{{ post.tags[0] }}</span>
          <span v-if="post.tags.length > 1" class="text-gray-400">+{{ post.tags.length - 1 }}</span>
        </span>
      </div>

      <!-- Content preview -->
      <div class="max-w-none mb-5">
        <p class="text-gray-300 leading-relaxed text-base whitespace-pre-wrap">
          {{ contentPreview }}
        </p>
      </div>

      <!-- Read more link -->
      <NuxtLink
        :to="`/blog/${blogSlug}`"
        class="inline-flex items-center gap-2 text-sm font-semibold text-[#ef5552] hover:text-[#ef5552]/80 transition-colors duration-200 group"
      >
        <span>Read more</span>
        <svg class="w-4 h-4 transform group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </NuxtLink>
    </div>
  </article>
</template>
