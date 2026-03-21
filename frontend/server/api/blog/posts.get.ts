import { getQuery } from 'h3';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const locale = (query.locale as string) || 'en';

  let posts = await getBlogPosts(locale);
  if (posts.length === 0 && locale !== 'en') {
    posts = await getBlogPosts('en');
  }
  return posts;
});
