import { getQuery, createError } from 'h3';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') || '';
  const query = getQuery(event);
  const locale = (query.locale as string) || 'en';

  const isBlog = slug.startsWith('blog/');
  if (isBlog) {
    const blogSlug = slug.replace(/^blog\//, '');
    const localized = await getBlogPost(locale, blogSlug);
    const post = localized || (locale !== 'en' ? await getBlogPost('en', blogSlug) : null);
    if (!post) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    return { ...post, isFallback: !localized };
  }

  const localized = await getContentPage(locale, slug);
  const page = localized || (locale !== 'en' ? await getContentPage('en', slug) : null);
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }
  return { ...page, isFallback: !localized };
});
