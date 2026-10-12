import { isReservedLocalePath } from '~~/server/utils/localeRouting';
import { htmlPathIsShareable, visitorCacheTier } from '~~/server/utils/visitorCacheTier';
import { logger } from '~~/server/utils/logger';

// Browser HTML stays private and must revalidate: cached identity can change behind an httpOnly session cookie.
// Only the shared tier may receive CDN-Cache-Control; replaying its header/body pair reuses a matching CSP nonce
// within the TTL. This deliberately trades per-request nonce uniqueness for shared caching during that window.
// Cloudflare rules must make paths eligible and bypass session/preference cookies.
// Reporting-Endpoints binds the named endpoint used by CSP report-to.

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;

  // Reserved routes own their cache policy; public assets are served before middleware.
  if (isReservedLocalePath(path)) return;

  const { cspReportUri } = useRuntimeConfig(event);
  if (cspReportUri) {
    setResponseHeader(event, 'Reporting-Endpoints', `posthog="${cspReportUri}"`);
  }

  const tier = visitorCacheTier(event);

  // Expose every tier for traffic measurement and Cloudflare rule verification.
  setResponseHeader(event, 'X-Nd-Cache-Tier', tier);

  // Mark page responses for 04-html-conditional-get, whose hook also receives API responses.
  event.context.ndCacheTier = tier;

  // Preserve explicit policies, including the locale router's private, no-store redirect.
  if (getResponseHeader(event, 'Cache-Control')) return;

  // Force revalidation rather than heuristic browser reuse of stale identity or obsolete chunk URLs.
  setResponseHeader(event, 'Cache-Control', 'private, no-cache');

  // Require both a shareable visitor and path; the plugin adds CDN headers after verifying the rendered status.
  if (tier === 'shared' && htmlPathIsShareable(path)) {
    event.context.ndShareable = true;
  }

  if (import.meta.dev) {
    logger.debug({ path, tier }, 'html cache tier');
  }
});
