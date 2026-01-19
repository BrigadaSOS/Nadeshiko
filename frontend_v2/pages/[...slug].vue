<script setup lang="ts">
const route = useRoute()
const { locale } = useI18n()

/**
 * @docs queryContent https://content.nuxt.com/composables/query-content
 */
async function fetchContent() {
	try {
		return await queryCollection('content').path(`/${locale.value.toLowerCase()}${route.path}`).first()
	} catch (err: any) {
		return await queryCollection('content').path(`/${route.path}`).first()
	}
}

/**
 * @docs https://nuxt.com/docs/api/composables/use-async-data
 */
const { data } = await useAsyncData(
  () => `content-${locale.value}-${route.path}`,
  () => fetchContent(),
  { watch: [() => route.path, locale] }
)

// Check if this is a blog post
const isBlogPost = computed(() => route.path.startsWith('/blog/'))

// Format date for blog posts
const formattedDate = computed(() => {
  if (!data.value?.date) return null
  try {
    const date = new Date(data.value.date)
    if (isNaN(date.getTime())) return null
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  } catch {
    return null
  }
})

// SEO meta
useHead({
  title: data.value?.title || 'Nadeshiko',
  meta: [
    { name: 'description', content: data.value?.description || '' }
  ]
})
</script>

<template>
  <NuxtLayout>
    <div class="min-h-screen">
      <!-- Content -->
      <div v-if="data" class="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:pt-3 sm:pb-12">
        <div class="content-markdown">
          <ContentRenderer
            :value="data"
          >
            <template #empty>
              <p class="text-gray-400">{{ $t('contentPage.emptyMessage') }}</p>
            </template>
          </ContentRenderer>
        </div>
      </div>

      <!-- Debug: Show when content is not found -->
      <div v-else class="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:pt-3 sm:pb-12">
        <div class="content-markdown">
          <p class="text-gray-400">Content not found. Path: {{ route.path }}, Locale: {{ locale }}</p>
        </div>
      </div>

      <!-- Back to Blog Link for Blog Posts -->
      <div v-if="isBlogPost && data" class="mx-auto max-w-6xl px-4 pb-8">
        <NuxtLink
          to="/blog"
          class="inline-flex items-center gap-2 text-[#ef5552] hover:text-[#ef5552]/80 transition-colors duration-200 font-medium"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Blog
        </NuxtLink>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.content-markdown {
  padding: 1.25rem 2.5rem 2.5rem 2.5rem;
}

@media (min-width: 640px) {
  .content-markdown {
    padding: 1.75rem 3.5rem 3.5rem 3.5rem;
  }
}

@media (min-width: 1024px) {
  .content-markdown {
    padding: 2rem 4rem 4rem 4rem;
  }
}

/* Images */
.content-markdown :deep(img) {
  width: 100%;
  height: auto;
  border-radius: 0.75rem;
  margin: 2.5rem 0;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(239, 85, 82, 0.1);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.content-markdown :deep(img:hover) {
  transform: translateY(-4px);
  box-shadow: 0 25px 30px -5px rgba(0, 0, 0, 0.4), 0 15px 15px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(239, 85, 82, 0.2);
}

/* Lists */
.content-markdown :deep(ol),
.content-markdown :deep(ul) {
  margin-left: 1.5rem;
  margin-bottom: 1.5rem;
  color: #e5e7eb;
}

.content-markdown :deep(ol) {
  list-style-type: decimal;
}

.content-markdown :deep(ul) {
  list-style-type: disc;
}

.content-markdown :deep(li) {
  margin-bottom: 0.75rem;
  line-height: 1.8;
  padding-left: 0.5rem;
  color: #d1d5db;
}

.content-markdown :deep(li::marker) {
  color: #ef5552;
  font-weight: 600;
}

/* Nested lists */
.content-markdown :deep(li > ul),
.content-markdown :deep(li > ol) {
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
}

/* Headings */
.content-markdown :deep(h1) {
  font-size: 2.5rem;
  font-weight: 800;
  margin-top: 3rem;
  margin-bottom: 1.75rem;
  color: white;
  line-height: 1.2;
  position: relative;
  padding-left: 1rem;
}

.content-markdown :deep(h1::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 0.25rem;
  bottom: 0.25rem;
  width: 4px;
  background: linear-gradient(to bottom, #ef5552, #ef5552aa);
  border-radius: 2px;
}

.content-markdown :deep(h1:first-child) {
  margin-top: 0;
}

@media (min-width: 768px) {
  .content-markdown :deep(h1) {
    font-size: 2.75rem;
  }
}

.content-markdown :deep(h2) {
  font-size: 2rem;
  font-weight: 700;
  margin-top: 2rem;
  margin-bottom: 1.25rem;
  color: white;
  line-height: 1.3;
}

@media (min-width: 768px) {
  .content-markdown :deep(h2) {
    font-size: 2.25rem;
  }
}

.content-markdown :deep(h3) {
  font-size: 1.625rem;
  font-weight: 600;
  margin-top: 2.5rem;
  margin-bottom: 1rem;
  color: #f9fafb;
  line-height: 1.4;
}

@media (min-width: 768px) {
  .content-markdown :deep(h3) {
    font-size: 1.75rem;
  }
}

.content-markdown :deep(h4) {
  font-size: 1.375rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 0.875rem;
  color: #f3f4f6;
  line-height: 1.5;
}

/* Paragraphs */
.content-markdown :deep(p) {
  font-size: 1.125rem;
  color: #d1d5db;
  margin-bottom: 1.5rem;
  line-height: 1.8;
  letter-spacing: 0.01em;
}

/* Links */
.content-markdown :deep(a) {
  color: #ef5552;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s ease;
  border-bottom: 1px solid transparent;
}

.content-markdown :deep(a:hover) {
  color: #ff6b68;
  border-bottom-color: #ef5552;
}

/* Blockquotes */
.content-markdown :deep(blockquote) {
  border-left: 4px solid #ef5552;
  padding: 1.25rem 1.5rem;
  margin: 2rem 0;
  background: rgba(239, 85, 82, 0.05);
  border-radius: 0 0.5rem 0.5rem 0;
  color: #d1d5db;
  font-style: italic;
}

.content-markdown :deep(blockquote p) {
  margin-bottom: 0;
}

/* Code blocks */
.content-markdown :deep(code) {
  background-color: rgba(239, 85, 82, 0.15);
  color: #ff6b68;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.9em;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  border: 1px solid rgba(239, 85, 82, 0.3);
}

.content-markdown :deep(pre) {
  background: #0d1117;
  border-radius: 0.75rem;
  padding: 1.5rem;
  overflow-x: auto;
  margin: 2rem 0;
  border: 1px solid #30363d;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}

.content-markdown :deep(pre code) {
  background-color: transparent;
  color: #e5e7eb;
  padding: 0;
  border: none;
  font-size: 0.95rem;
  line-height: 1.7;
}

/* Tables */
.content-markdown :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 2rem 0;
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
}

.content-markdown :deep(th),
.content-markdown :deep(td) {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid #374151;
}

.content-markdown :deep(th) {
  background: linear-gradient(to bottom, #1f2937, #18212f);
  color: white;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.875rem;
  letter-spacing: 0.05em;
}

.content-markdown :deep(td) {
  color: #d1d5db;
}

.content-markdown :deep(tr:hover) {
  background-color: rgba(239, 85, 82, 0.05);
}

.content-markdown :deep(tbody tr:last-child td) {
  border-bottom: none;
}

/* Horizontal rule */
.content-markdown :deep(hr) {
  border: none;
  height: 1px;
  background: linear-gradient(to right, transparent, #ef5552, transparent);
  margin: 3rem 0;
}

/* Strong and emphasis */
.content-markdown :deep(strong) {
  color: white;
  font-weight: 700;
}

.content-markdown :deep(em) {
  color: #e5e7eb;
}

/* Contributor boxes and grid styling */
.content-markdown :deep(.grid) {
  gap: 1.5rem;
}

.content-markdown :deep(.border) {
  border-radius: 0.75rem;
  overflow: hidden;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.content-markdown :deep(.border:hover) {
  transform: translateY(-2px);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}

.content-markdown :deep(.border img) {
  margin: 0;
  border-radius: 0;
  box-shadow: none;
  transition: none;
  border: none;
}

.content-markdown :deep(.border img:hover) {
  transform: none;
  box-shadow: none;
}
</style>
