import { createError, getRouterParam, setHeader } from 'h3';
import { getNitroOrigin } from '#site-config/server/composables/getNitroOrigin';
import { INDEXED_LOCALES } from '~/utils/i18n';

/**
 * The blog as a feed, one per indexed locale.
 *
 * There was none, and no `rel="alternate"` in any head either, so the only way
 * to follow the blog was to remember to visit it. Readers who follow immersion
 * projects overwhelmingly do it from a reader.
 *
 * Scoped to `INDEXED_LOCALES` for the same reason the sitemap is: `ja` renders
 * but is `robots: false`, and publishing a feed for it would be advertising a
 * surface the rest of the site is deliberately not advertising.
 */
export default defineEventHandler(async (event) => {
  const locale = getRouterParam(event, 'locale') ?? '';
  if (!(INDEXED_LOCALES as readonly string[]).includes(locale)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  // The module's own resolver rather than a hand-rolled origin, so the feed
  // cannot start advertising a different host than the canonicals do. Trailing
  // slash trimmed because every URL below appends its own path.
  const siteUrl = getNitroOrigin(event).replace(/\/$/, '');

  let posts = await getBlogPosts(locale);
  if (posts.length === 0 && locale !== 'en') posts = await getBlogPosts('en');

  const feedUrl = `${siteUrl}/${locale}/blog/rss.xml`;
  const blogUrl = `${siteUrl}/${locale}/blog`;

  const items = posts
    .map((post) => {
      const link = `${siteUrl}/${locale}${post.path}`;
      return [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <description>${escapeXml(post.description)}</description>`,
        post.date ? `      <pubDate>${new Date(post.date).toUTCString()}</pubDate>` : '',
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  setHeader(event, 'content-type', 'application/rss+xml; charset=utf-8');
  // Same window the blog itself is cached for; a post is not urgent.
  setHeader(event, 'cache-control', 'public, max-age=3600');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Nadeshiko Blog</title>
    <link>${escapeXml(blogUrl)}</link>
    <description>Updates from Nadeshiko.</description>
    <language>${escapeXml(locale)}</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
});

/** Titles and descriptions are authored text and routinely contain & and quotes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
