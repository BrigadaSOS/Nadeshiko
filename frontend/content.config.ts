import { defineContentConfig, defineCollection } from '@nuxt/content';
import { asSitemapCollection } from '@nuxtjs/sitemap/content';
import { z } from 'zod';

const blogSchema = z.object({
  date: z.date(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  image: z.string().optional(),
  excerpt: z.string().optional(),
  rawbody: z.string(),
});

export default defineContentConfig({
  collections: {
    content_en: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'en/**', prefix: '' },
      }),
    ),
    content_es: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'es/**', prefix: '' },
      }),
    ),
    content_ja: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'ja/**', prefix: '' },
      }),
    ),
    blog_en: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'en/blog/**', prefix: '/blog' },
        schema: blogSchema,
      }),
    ),
    blog_es: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'es/blog/**', prefix: '/blog' },
        schema: blogSchema,
      }),
    ),
    blog_ja: defineCollection(
      asSitemapCollection({
        type: 'page',
        source: { include: 'ja/blog/**', prefix: '/blog' },
        schema: blogSchema,
      }),
    ),
  },
});
