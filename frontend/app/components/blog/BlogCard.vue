<script setup lang="ts">
import { blogExcerpt } from '~/utils/blogExcerpt';
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

const { d } = useI18n();

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
    // A real `Date` is exempt, and it has to be: the check below is looking for
    // the empty object a JSON round-trip leaves where a date used to be, and a
    // `Date` has no own enumerable keys either -- so it was being discarded by
    // the guard meant to catch its corpse. `date` is declared `string | Date |
    // null`, so this is the ordinary case, and it rendered no date at all.
    if (
      !(dateValue instanceof Date) &&
      typeof dateValue === 'object' &&
      !Array.isArray(dateValue) &&
      dateValue !== null
    ) {
      const keys = Object.keys(dateValue);
      if (keys.length === 0) return null;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;

    return d(date, 'dateUtc');
  } catch {
    return null;
  }
});

const contentPreview = computed(() => blogExcerpt(props.post.rawbody, props.post.description || ''));
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
      <div v-if="post.image" class="mt-4 mb-5 flex justify-center">
        <img
          :src="post.image"
          :alt="post.title"
          loading="lazy"
          class="rounded-lg border border-white/10 group-hover:scale-105 transition-transform duration-300 max-h-[40rem] max-w-full"
        />
      </div>

      <!-- Content preview -->
      <div class="relative max-w-none" :class="{ 'mt-5': !post.image }">
        <p class="content-preview">{{ contentPreview }}</p>
        <div class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#1d1d1d] to-transparent pointer-events-none" />
      </div>

      <!-- Read more -->
      <span class="inline-flex items-center gap-2 text-base font-semibold text-red-400 group-hover:text-red-300 transition-colors duration-200 mt-4">
        <span>{{ $t('blog.readMore') }}</span>
        <svg class="w-5 h-5 transform group-hover:translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </span>
    </NuxtLink>
  </article>
</template>

<style scoped>
/* The excerpt is a single text node now, so the typography that used to sit on
   the injected children belongs on the element itself. The `:deep()` rules for
   p / strong / a / ul / li went with the HTML they styled. */
.content-preview {
  max-height: 16rem;
  overflow: hidden;
  font-size: 1.125rem;
  color: #d1d5db;
  line-height: 1.8;
  letter-spacing: 0.01em;
  margin-bottom: 1rem;
}
</style>
