<script setup lang="ts">
const route = useRoute();
const { locale } = useI18n();
const { url: siteUrl } = useSiteConfig();
const localePath = useLocalePath();

const slug = computed(() => {
  let raw = route.path.replace(/^\//, '').replace(/\/$/, '');
  if (locale.value !== 'en' && raw.startsWith(`${locale.value}/`)) {
    raw = raw.slice(locale.value.length + 1);
  }
  return raw || 'index';
});

const isBlogPost = computed(() => slug.value.startsWith('blog/'));

const { data } = await useAsyncData(
  () => `content-${locale.value}-${route.path}`,
  () =>
    $fetch(`/api/content/${slug.value}`, {
      query: { locale: locale.value.toLowerCase() },
    }).catch(() => null),
  { watch: [() => route.path, locale] },
);

if (!data.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page Not Found' });
}

const title = computed(() => data.value?.title || undefined);
const description = computed(() => data.value?.description || '');
const canonicalUrl = computed(() => new URL(route.path || '/', siteUrl).toString());
const contentDate = computed(() => {
  const d = data.value as Record<string, any> | null;
  const raw = d?.date ?? d?.meta?.date;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
});
const contentAuthor = computed(() => {
  const d = data.value as Record<string, any> | null;
  const raw = d?.author ?? d?.meta?.author;
  return typeof raw === 'string' && raw ? raw : null;
});

const schemaOrgDefs = computed(() => {
  const defs: any[] = [
    defineWebPage({
      name: title.value,
      description: description.value || undefined,
      url: canonicalUrl.value,
      inLanguage: locale.value,
    }),
  ];

  const breadcrumbItems = [{ name: 'Home', item: localePath('/') }];
  if (isBlogPost.value) {
    breadcrumbItems.push({ name: 'Blog', item: localePath('/blog') });
  }
  breadcrumbItems.push({ name: title.value ?? '', item: route.path });
  defs.push(defineBreadcrumb({ itemListElement: breadcrumbItems }));

  if (isBlogPost.value && data.value?.title) {
    const articleDef: Record<string, unknown> = {
      headline: data.value.title,
      description: description.value || undefined,
    };
    if (contentDate.value) {
      articleDef.datePublished = contentDate.value;
      articleDef.dateModified = contentDate.value;
    }
    if (contentAuthor.value) {
      articleDef.author = { name: contentAuthor.value };
    }
    defs.push(defineArticle(articleDef));
  }

  return defs;
});

useSchemaOrg(schemaOrgDefs);

const requestOrigin = useRequestURL().origin;

useHead(() => ({
  title: title.value,
  meta: [
    { name: 'description', content: description.value },
    { property: 'og:title', content: title.value },
    { property: 'og:description', content: description.value },
    { property: 'og:image', content: `${requestOrigin}/logo-og-5bc76788.png` },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title.value },
    { name: 'twitter:description', content: description.value },
  ],
}));
</script>

<template>
  <div class="min-h-screen">
      <div v-if="data" class="mx-auto px-4 md:px-0 md:max-w-[70%] py-6">
        <div class="content-markdown" :class="{ 'is-blog-post': isBlogPost }">
          <template v-if="isBlogPost">
            <h1 class="blog-title">{{ title }}</h1>
            <time v-if="contentDate" class="blog-date" :datetime="contentDate">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {{ new Date(contentDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }}
            </time>
          </template>
          <div v-html="data.html" />

          <div v-if="isBlogPost" class="mt-10 pt-6 border-t border-gray-800">
            <NuxtLink
              :to="localePath('/blog')"
              class="inline-flex items-center gap-2 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors duration-200 group"
            >
              <svg class="w-4 h-4 transform group-hover:-translate-x-1 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Blog</span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
.content-markdown {
  padding: 0;
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
  color: var(--button-color-accent);
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
  margin-top: 0;
  margin-bottom: 0.75rem;
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
  background: var(--button-color-accent);
  border-radius: 2px;
}

.content-markdown :deep(h1:first-child) {
  margin-top: 0;
}

.content-markdown.is-blog-post :deep(h1:not(.blog-title)) {
  display: none;
}

.content-markdown .blog-title {
  font-size: 2.5rem;
  font-weight: 800;
  margin-top: 0;
  margin-bottom: 0.5rem;
  color: #f3f4f6;
  line-height: 1.2;
  position: relative;
  padding-left: 1rem;
}

.content-markdown .blog-title::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.25rem;
  bottom: 0.25rem;
  width: 4px;
  background: var(--button-color-accent);
  border-radius: 2px;
}

@media (min-width: 768px) {
  .content-markdown .blog-title {
    font-size: 2.75rem;
  }
}

.content-markdown .blog-date {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--button-color-accent);
  font-size: 0.875rem;
  padding-left: 1rem;
  margin-bottom: 0;
}

@media (min-width: 768px) {
  .content-markdown :deep(h1) {
    font-size: 2.75rem;
  }
}

.content-markdown :deep(h2) {
  font-size: 2rem;
  font-weight: 700;
  margin-top: 0.5rem;
  margin-bottom: 1.25rem;
  color: #d1d5db;
  line-height: 1.3;
  text-decoration: underline;
  text-underline-offset: 0.5rem;
  text-decoration-thickness: 4px;
  text-decoration-color: var(--button-color-accent);
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
  color: var(--button-color-accent);
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
  color: var(--button-color-accent);
  line-height: 1.5;
}

/* Images */
.content-markdown :deep(p:has(> img)) {
  display: flex;
  justify-content: center;
}

.content-markdown :deep(img) {
  max-width: 100%;
  max-height: 40rem;
  margin: 1rem 0 0.5rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.content-markdown :deep(img + em),
.content-markdown :deep(p:has(> img) + p > em:only-child) {
  display: block;
  text-align: center;
  color: #9ca3af;
  font-style: normal;
  font-size: 0.925rem;
  margin-bottom: 2rem;
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
  color: var(--button-color-accent);
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s ease;
  border-bottom: 1px solid transparent;
}

.content-markdown :deep(a:hover) {
  color: #fca5a5;
  border-bottom-color: var(--button-color-accent);
}

/* Links inside headings */
.content-markdown :deep(h1 a),
.content-markdown :deep(h2 a) {
  color: #d1d5db;
  border-bottom: 2px solid var(--button-color-accent);
}

.content-markdown :deep(h3 a),
.content-markdown :deep(h4 a) {
  color: inherit;
  border-bottom: none;
}

.content-markdown :deep(h1 a:hover),
.content-markdown :deep(h2 a:hover),
.content-markdown :deep(h3 a:hover),
.content-markdown :deep(h4 a:hover) {
  color: var(--button-color-accent);
}

.content-markdown :deep(blockquote) {
  border-left: 4px solid var(--button-color-accent);
  background-color: color-mix(in srgb, var(--button-color-accent) 8%, transparent);
  padding: 1rem 1.25rem;
  margin: 1.5rem 0;
  border-radius: 0 0.5rem 0.5rem 0;
}

.content-markdown :deep(blockquote p) {
  margin-bottom: 0;
  font-size: 1rem;
  color: #e5e7eb;
}

.content-markdown :deep(blockquote strong) {
  color: var(--button-color-accent);
}

/* Code blocks (shiki) */
.content-markdown :deep(pre.shiki) {
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 0.5rem 0 1.5rem;
  font-size: 0.875rem;
  line-height: 1.7;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.content-markdown :deep(pre.shiki code) {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}

/* Inline code */
.content-markdown :deep(code) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 0.875em;
  background: rgba(255, 255, 255, 0.08);
  padding: 0.15em 0.4em;
  border-radius: 0.3em;
  color: #e1e4e8;
}

/* Contributor card overrides */
.content-markdown :deep(.about-contributor-card img) {
  margin: 0;
}

.content-markdown :deep(.about-contributor-card p) {
  font-size: 1rem;
  line-height: 1.5;
  margin-bottom: 0;
}

/* Contributor card: stacked layout when 3 cols are narrow (768px-949px) */
@media (min-width: 768px) and (max-width: 949px) {
  .content-markdown :deep(.about-contributor-card > .flex) {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
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
