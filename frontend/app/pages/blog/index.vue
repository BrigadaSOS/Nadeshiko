<script setup lang="ts">
const { markAsRead } = useBlogNotification();
onMounted(() => markAsRead());

const { locale } = useI18n();
const route = useRoute();

const page = computed(() => Number(route.query.page || 1));
const pageSize = 9;

const { data: posts } = await useAsyncData(
  `blog-posts-${locale.value}-${page.value}`,
  async () => {
    const lang = locale.value.toLowerCase();

    const allPosts = await $fetch('/api/blog/posts', {
      query: { locale: lang },
    }).catch(() => [] as any[]);

    const start = (page.value - 1) * pageSize;
    const end = start + pageSize;

    return {
      posts: allPosts.slice(start, end),
      total: allPosts.length,
      totalPages: Math.ceil(allPosts.length / pageSize),
    };
  },
  { watch: [page, locale] },
);

useSeoMeta({
  title: 'Blog',
  ogTitle: 'Blog',
  description: 'Stay updated with the latest news, features, and improvements to Nadeshiko.',
  ogDescription: 'Stay updated with the latest news, features, and improvements to Nadeshiko.',
  ogImage: `${useRequestURL().origin}/logo-og-5bc76788.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: 'Blog',
  twitterDescription: 'Stay updated with the latest news, features, and improvements to Nadeshiko.',
});

useSchemaOrg([defineWebPage({ '@type': 'CollectionPage' })]);
</script>

<template>
  <div class="min-h-screen">
      <!-- Content -->
      <div class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6">
        <div class="content-markdown">
          <h1>Blog</h1>

          <div v-if="posts?.posts.length">
            <BlogCard v-for="post in posts.posts" :key="(post as any).slug || post.path" :post="post as any" />
          </div>

          <div v-else class="text-center text-gray-400 py-20">
            No blog posts available yet. Stay tuned!
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
</style>
