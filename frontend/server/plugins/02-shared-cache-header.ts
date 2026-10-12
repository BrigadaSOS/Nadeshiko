// Emit CDN caching only after the render succeeds. Cache 200 pages, never errors, missing pages or redirects.

import { sharedCdnMaxAge } from '~~/server/utils/sharedCdnTtl';

export default defineNitroPlugin((nitroApp) => {
  // Write in render:response before the renderer applies headers; beforeResponse is too late for this header.
  nitroApp.hooks.hook('render:response', (response, { event }) => {
    if (!event.context.ndShareable) return;
    if (response.statusCode !== undefined && response.statusCode !== 200) return;

    // Non-production still exercises cache-header gating, with a shorter TTL.
    const environment = useRuntimeConfig(event).public.environment;

    response.headers = {
      ...response.headers,
      'CDN-Cache-Control': `public, max-age=${sharedCdnMaxAge(getRequestURL(event).pathname, environment)}`,
    };
  });
});
