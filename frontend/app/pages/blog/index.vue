<script setup lang="ts">
import { handleApiError } from '~/utils/apiError';
import { DEFAULT_OG_IMAGE_PATH } from '~/utils/metaTags';

const { locale, t } = useI18n();
const route = useRoute();
const localePath = useLocalePath();

// `?page=99`, `?page=0`, `?page=-1` and `?page=abc` all rendered 200 with "No
// blog posts available yet" -- untrue, and indexable. Anything that is not a
// positive integer is page 1; a page past the end is handled below.
const page = computed(() => {
  const raw = Number(route.query.page);
  return Number.isInteger(raw) && raw >= 1 ? raw : 1;
});
const pageSize = 9;

const { data: posts, refresh } = await useAsyncData(
  `blog-posts-${locale.value}-${page.value}`,
  async () => {
    const lang = locale.value.toLowerCase();

    const result = await $fetch<{ posts: any[]; isFallback: boolean }>('/api/blog/posts', {
      query: { locale: lang },
    }).catch((error: unknown) => {
      // Also runs during SSR, where a toast has nowhere to go; the inline notice
      // below is what stops a failed fetch from reading as "no posts yet".
      handleApiError('blog:posts-fetch-failed', error, { toastKey: false });
      return null;
    });

    if (!result) return null;

    const allPosts = result.posts;
    const start = (page.value - 1) * pageSize;
    const end = start + pageSize;

    return {
      posts: allPosts.slice(start, end),
      total: allPosts.length,
      totalPages: Math.ceil(allPosts.length / pageSize),
      isFallback: result.isFallback,
    };
  },
  { watch: [page, locale] },
);

// A page past the last one is a wrong URL, not an empty blog. Rendering it as
// 200 told crawlers the blog had no posts, from any `?page=` a link or a bot
// happened to invent. Page 1 stays 200 even with nothing published, because
// then "no posts yet" is the true answer.
if (posts.value && posts.value.totalPages > 0 && page.value > posts.value.totalPages) {
  throw createError({ statusCode: 404, statusMessage: 'Page Not Found' });
}

useSeoMeta({
  title: () => t('seo.blog.title'),
  ogTitle: () => t('seo.blog.title'),
  description: () => t('seo.blog.description'),
  ogDescription: () => t('seo.blog.description'),
  ogImage: `${useRequestURL().origin}${DEFAULT_OG_IMAGE_PATH}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => t('seo.blog.title'),
  twitterDescription: () => t('seo.blog.description'),
});

useSchemaOrg([defineWebPage({ '@type': 'CollectionPage' })]);

// Without this the feed exists but nothing finds it: readers discover one from
// the page it belongs to, not by guessing a path.
useHead({
  link: [
    {
      rel: 'alternate',
      type: 'application/rss+xml',
      title: 'Nadeshiko Blog',
      href: localePath('/blog/rss.xml'),
    },
  ],
});
</script>

<template>
  <div class="min-h-screen">
      <!-- Content -->
      <div class="nd-page px-4 md:px-0 pb-6">
        <div class="content-markdown">
          <h1>{{ t('blog.title') }}</h1>

          <p v-if="posts?.isFallback" class="translation-notice">
            {{ t('common.translationUnavailable') }}
          </p>

          <div v-if="!posts" class="py-20 text-center text-sm" data-testid="blog-load-error">
            <p class="text-red-400">{{ t('errors.generic') }}</p>
            <button
              type="button"
              class="mt-3 py-1.5 px-3 text-xs font-bold rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              @click="refresh()"
            >
              {{ t('searchContainer.retryButton') }}
            </button>
          </div>

          <div v-else-if="posts.posts.length" :lang="posts.isFallback ? 'en' : undefined">
            <BlogCard v-for="post in posts.posts" :key="(post as any).slug || post.path" :post="post as any" />
          </div>

          <div v-else class="text-center text-gray-400 py-20">
            {{ t('blog.empty') }}
          </div>

          <div v-if="posts && posts.totalPages > 1" class="mt-12 flex justify-center">
            <BlogPagination :current-page="page" :total-pages="posts.totalPages" base-path="/blog" />
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
.content-markdown {
  padding: 0;
}

.content-markdown :deep(h1) {
  font-size: 2.5rem;
  font-weight: 800;
  margin-top: 0;
  margin-bottom: 0.75rem;
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
  background: var(--button-color-accent);
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

.translation-notice {
  margin: 0 0 2rem 1rem;
  padding: 0.75rem 1rem;
  border-left: 4px solid var(--button-color-accent);
  background-color: color-mix(in srgb, var(--button-color-accent) 8%, transparent);
  border-radius: 0 0.5rem 0.5rem 0;
  color: #e5e7eb;
  font-size: 0.9375rem;
}
</style>
