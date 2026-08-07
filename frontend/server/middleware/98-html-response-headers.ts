import { isReservedLocalePath } from '~~/server/utils/localeRouting';

/**
 * Response headers every rendered page needs, which neither `routeRules` nor
 * nuxt-security can express.
 *
 * **`Cache-Control: private`** — `security.nonce` stamps a per-request nonce into
 * both the CSP header and the inline scripts of every SSR page. A shared cache
 * that stores one visitor's response and replays it to another serves a nonce
 * that no longer matches, and the browser blocks every inline script on the page
 * — the app does not boot. `private` is what tells intermediaries not to do that.
 * Pages otherwise emit no `Cache-Control` at all, which leaves the decision to
 * heuristics: nothing reuses them in practice, because there is no `ETag` or
 * `Last-Modified` to compute freshness from, but nothing forbids it either.
 *
 * Deliberately not `no-store`: the visitor's own browser cache is safe (it
 * replays the matching header alongside the body), and `no-store` would cost the
 * back/forward cache for no security gain. Routes wanting more say so themselves
 * — `/` is `private, no-store` — and an already-set header is left alone.
 *
 * **`Reporting-Endpoints`** — declares the named endpoint that the CSP
 * `report-to posthog` directive refers to. Without this header the directive
 * names nothing and Chrome sends no reports.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname;

  // Public assets are served before middleware runs, but reserved routes (the
  // API proxy, sitemaps, docs) still reach here and own their caching story.
  if (isReservedLocalePath(path)) return;

  const { cspReportUri } = useRuntimeConfig(event);
  if (cspReportUri) {
    setResponseHeader(event, 'Reporting-Endpoints', `posthog="${cspReportUri}"`);
  }

  if (getResponseHeader(event, 'Cache-Control')) return;

  setResponseHeader(event, 'Cache-Control', 'private');
});
