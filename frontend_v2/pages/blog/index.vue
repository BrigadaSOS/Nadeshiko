<script setup lang="ts">
const { locale } = useI18n()
const route = useRoute()

const page = computed(() => Number(route.query.page || 1))
const pageSize = 9

const { data: posts } = await useAsyncData(
  `blog-posts-${locale.value}-${page.value}`,
  async () => {
    // Get all content
    const allContent = await queryCollection('content').all()

    // Get English posts as the base
    const englishPosts = allContent.filter((post: any) => post.path?.startsWith('/en/blog/'))

    // Create a map of English posts by slug (filename)
    const postsMap = new Map()
    englishPosts.forEach((post: any) => {
      const slug = post.path?.split('/').pop()?.replace('.md', '')
      if (slug) {
        postsMap.set(slug, post)
      }
    })

    // If not English locale, get locale-specific posts and override
    if (locale.value.toLowerCase() !== 'en') {
      const blogPathPrefix = `/${locale.value.toLowerCase()}/blog/`
      const localePosts = allContent.filter((post: any) => post.path?.startsWith(blogPathPrefix))

      localePosts.forEach((post: any) => {
        const slug = post.path?.split('/').pop()?.replace('.md', '')
        if (slug) {
          postsMap.set(slug, post) // Override English version
        }
      })
    }

    // Convert map to array and sort
    const allPosts = Array.from(postsMap.values())
    const sortedPosts = allPosts
      .sort((a: any, b: any) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0
        const dateB = b.date ? new Date(b.date).getTime() : 0
        return dateB - dateA
      })

    const start = (page.value - 1) * pageSize
    const end = start + pageSize

    return {
      posts: sortedPosts.slice(start, end),
      total: sortedPosts.length,
      totalPages: Math.ceil(sortedPosts.length / pageSize)
    }
  },
  { watch: [page, locale] }
)

useSeoMeta({
  title: 'Blog - Nadeshiko',
  description: 'Stay updated with the latest news, features, and improvements to Nadeshiko.'
})
</script>

<template>
  <NuxtLayout>
    <div class="min-h-screen">
      <!-- Content -->
      <div class="mx-auto max-w-6xl px-4 pt-2 pb-8 sm:pt-3 sm:pb-12">
        <div class="content-markdown">
          <h1>Blog</h1>

          <div v-if="posts?.posts.length">
            <BlogCard v-for="post in posts.posts" :key="post.slug || post.path" :post="post" />
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
