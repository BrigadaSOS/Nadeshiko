import { getQuery, createError } from 'h3';
import { getContentPage, getBlogPost } from '../../utils/content';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') || '';
  const query = getQuery(event);
  const locale = (query.locale as string) || 'en';

  const isBlog = slug.startsWith('blog/');
  if (isBlog) {
    const blogSlug = slug.replace(/^blog\//, '');
    const post = (await getBlogPost(locale, blogSlug)) || (locale !== 'en' ? await getBlogPost('en', blogSlug) : null);
    if (!post) {
      throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }
    return post;
  }

  const page = (await getContentPage(locale, slug)) || (locale !== 'en' ? await getContentPage('en', slug) : null);
  if (!page) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }
  return page;
});
