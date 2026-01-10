<script setup lang="ts">
const route = useRoute()
const { locale } = useI18n()

async function fetchContent() {
	try {
		return await queryCollection('content').path(`/${locale.value.toLowerCase()}${route.path}`).first()
	} catch {
		return await queryCollection('content').path(`/${route.path}`).first()
	}
}

const { data } = await useAsyncData(
  () => `content-${locale.value}-${route.path}`,
  () => fetchContent(),
  { watch: [() => route.path, locale] }
)

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
      <div v-if="data" class="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:pt-3 sm:pb-12">
        <div class="content-markdown">
          <ContentRenderer :value="data">
            <template #empty>
              <p class="text-gray-400">{{ $t('contentPage.emptyMessage') }}</p>
            </template>
          </ContentRenderer>
        </div>
      </div>
    </div>
  </NuxtLayout>
</template>

<style scoped>
.content-markdown {
  padding: 1.25rem 0.5rem 2.5rem 0.5rem;
}

@media (min-width: 640px) {
  .content-markdown {
    padding: 1.75rem 2.5rem 3.5rem 2.5rem;
  }
}

@media (min-width: 1024px) {
  .content-markdown {
    padding: 2rem 4rem 4rem 4rem;
  }
}

/* Lists */
.content-markdown :deep(ul) {
  margin-left: 1.5rem;
  margin-bottom: 1.5rem;
  color: #e5e7eb;
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
.content-markdown :deep(li > ul) {
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
}

/* Headings */
.content-markdown :deep(h1) {
  font-size: 2.5rem;
  font-weight: 800;
  margin-top: 3rem;
  margin-bottom: 1.75rem;
  color: #f3f4f6;
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
  background: #ef5552;
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
  color: #d1d5db;
  line-height: 1.3;
  text-decoration: underline;
  text-underline-offset: 0.5rem;
  text-decoration-thickness: 4px;
  text-decoration-color: #ef5552;
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
  color: #d1d5db;
  line-height: 1.4;
  text-decoration: underline;
  text-underline-offset: 0.5rem;
  text-decoration-thickness: 4px;
  text-decoration-color: #ef5552;
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
  color: #d1d5db;
  line-height: 1.5;
  text-decoration: underline;
  text-underline-offset: 0.5rem;
  text-decoration-thickness: 4px;
  text-decoration-color: #ef5552;
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

/* Links inside headings */
.content-markdown :deep(h1 a),
.content-markdown :deep(h2 a),
.content-markdown :deep(h3 a),
.content-markdown :deep(h4 a) {
  color: #d1d5db;
  border-bottom: 2px solid #ef5552;
}

.content-markdown :deep(h1 a:hover),
.content-markdown :deep(h2 a:hover),
.content-markdown :deep(h3 a:hover),
.content-markdown :deep(h4 a:hover) {
  color: #ef5552;
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

/* Blurred background for contributor images */
.content-markdown :deep(.border .relative) {
  overflow: hidden;
  position: relative;
}

.content-markdown :deep(.border .relative::before) {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--pfp-bg, none);
  background-size: 125%;
  background-position: center;
  filter: blur(12px);
  z-index: 0;
  opacity: 0.5;
}

.content-markdown :deep(.border .relative img) {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: contain;
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
