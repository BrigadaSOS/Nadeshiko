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
    const blogCollection = `blog_${lang}` as any;

    // Get posts for the current locale, fallback to English
    let allPosts = await queryCollection(blogCollection)
      .all()
      .catch(() => []);
    if (allPosts.length === 0 && lang !== 'en') {
      allPosts = await queryCollection('blog_en')
        .all()
        .catch(() => []);
    }

    const sortedPosts = [...allPosts].sort((a: any, b: any) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

    const start = (page.value - 1) * pageSize;
    const end = start + pageSize;

    return {
      posts: sortedPosts.slice(start, end),
      total: sortedPosts.length,
      totalPages: Math.ceil(sortedPosts.length / pageSize),
    };
  },
  { watch: [page, locale] },
);

useSeoMeta({
  title: 'Blog',
  description: 'Stay updated with the latest news, features, and improvements to Nadeshiko.',
});

defineOgImage({
  title: 'Blog',
  description: 'Stay updated with the latest news, features, and improvements to Nadeshiko.',
} as any);

useSchemaOrg([defineWebPage({ '@type': 'CollectionPage' })]);
</script>

<template>
  <div class="min-h-screen">
      <!-- Content -->
      <div class="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:pt-3 sm:pb-12">
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
</style>
