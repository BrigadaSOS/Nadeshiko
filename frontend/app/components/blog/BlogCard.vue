<script setup lang="ts">
interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string | Date | null;
  image?: string;
  path?: string;
  rawbody?: string;
}

const props = defineProps<{
  post: BlogPost;
}>();

const blogPath = computed(() => {
  if (props.post.path) {
    return props.post.path;
  }
  return `/blog/${props.post.slug || ''}`;
});

const formattedDate = computed(() => {
  const dateValue = props.post.date;
  if (!dateValue) return null;

  try {
    if (typeof dateValue === 'object' && !Array.isArray(dateValue) && dateValue !== null) {
      const keys = Object.keys(dateValue);
      if (keys.length === 0) return null;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
});

const contentPreview = computed(() => {
  if (!props.post.rawbody) return props.post.description || '';

  const lines = props.post.rawbody
    .replace(/^---[\s\S]*?---\n*/m, '') // frontmatter
    .split('\n')
    .filter((line) => {
      if (/^#{1,6}\s/.test(line)) return false; // headings
      if (/^!\[/.test(line)) return false; // images
      if (/^\s*$/.test(line)) return false; // blank lines
      return true;
    })
    .slice(0, 10);

  const md = lines.join('\n\n');

  // Convert markdown to HTML
  return md
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/^[-*]\s+(.*)$/gm, '<li>$1</li>')
    .split('\n\n')
    .map((block) => {
      if (block.includes('<li>')) return `<ul>${block}</ul>`;
      return `<p>${block}</p>`;
    })
    .join('');
});
</script>

<template>
  <article data-testid="blog-post" class="mb-12 pb-10 border-b border-gray-800 last:border-0 hover:border-gray-700 transition-colors duration-200">
    <NuxtLink :to="blogPath" class="group block">
      <!-- Title -->
      <h2 class="text-3xl sm:text-4xl font-bold text-white mb-3 underline decoration-[#ef5552] decoration-4 underline-offset-8">
        {{ post.title }}
      </h2>

      <!-- Date -->
      <span v-if="formattedDate" class="inline-flex items-center gap-1.5 text-sm text-[#ef5552] mt-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {{ formattedDate }}
      </span>

      <!-- Image -->
      <div v-if="post.image" class="mt-4 mb-5 overflow-hidden rounded-lg">
        <img
          :src="post.image"
          :alt="post.title"
          class="w-full rounded-lg group-hover:scale-105 transition-transform duration-300"
        />
      </div>

      <!-- Content preview -->
      <div class="relative max-w-none" :class="{ 'mt-5': !post.image }">
        <div class="content-preview" v-html="contentPreview" />
        <div class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#1d1d1d] to-transparent pointer-events-none" />
      </div>

      <!-- Read more -->
      <span class="inline-flex items-center gap-2 text-base font-semibold text-red-400 group-hover:text-red-300 transition-colors duration-200 mt-4">
        <span>Read more</span>
        <svg class="w-5 h-5 transform group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </NuxtLink>
  </article>
</template>

<style scoped>
.content-preview {
  max-height: 16rem;
  overflow: hidden;
}

.content-preview :deep(p) {
  font-size: 1.125rem;
  color: #d1d5db;
  margin-bottom: 1rem;
  line-height: 1.8;
  letter-spacing: 0.01em;
}

.content-preview :deep(strong) {
  color: #e5e7eb;
  font-weight: 600;
}

.content-preview :deep(a) {
  color: #f87171;
  text-decoration: none;
}

.content-preview :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
  margin-bottom: 1rem;
}

.content-preview :deep(li) {
  font-size: 1.125rem;
  color: #d1d5db;
  line-height: 1.8;
  margin-bottom: 0.25rem;
}
</style>
