import { createReadStream } from 'node:fs';
import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestURL,
  sendStream,
  setHeader,
  setResponseStatus,
} from 'h3';
import { publishedSitemap, sitemapSnapshotFile } from '../utils/sitemapSnapshot';

export default defineEventHandler(async (event) => {
  const dir = String(useRuntimeConfig(event).sitemapSnapshotDir || '');
  if (!dir || process.env.NADESHIKO_SITEMAP_GENERATOR === '1') return;
  const path = getRequestURL(event).pathname;
  if (path.startsWith('/api/__sitemap__/'))
    throw createError({ statusCode: 404, statusMessage: 'Sitemap source unavailable' });
  const file = sitemapSnapshotFile(path);
  if (!file && !path.startsWith('/__sitemap__/')) return;
  if (!file) throw createError({ statusCode: 404, statusMessage: 'Unknown sitemap' });
  if (event.method !== 'GET' && event.method !== 'HEAD')
    throw createError({ statusCode: 405, statusMessage: 'Method not allowed' });
  let snapshot;
  try {
    snapshot = await publishedSitemap(dir, file);
  } catch {
    setHeader(event, 'Cache-Control', 'no-store');
    setHeader(event, 'Retry-After', '60');
    // Never fall through to expensive generation in a reader-serving worker.
    throw createError({ statusCode: 503, statusMessage: 'Sitemap snapshot unavailable' });
  }
  setHeader(event, 'Content-Type', 'text/xml; charset=UTF-8');
  setHeader(event, 'Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  setHeader(event, 'ETag', snapshot.etag);
  setHeader(event, 'X-Sitemap-Generated', snapshot.generatedAt);
  if (
    getHeader(event, 'if-none-match')
      ?.split(',')
      .some((tag) => tag.trim().replace(/^W\//, '') === snapshot.etag || tag.trim() === '*')
  ) {
    setResponseStatus(event, 304);
    return '';
  }
  setHeader(event, 'Content-Length', String(snapshot.bytes));
  if (event.method === 'HEAD') return '';
  return sendStream(event, createReadStream(snapshot.path));
});
