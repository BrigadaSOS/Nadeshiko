import { isReservedLocalePath } from '~~/server/utils/localeRouting';
import { htmlPathIsShareable, visitorCacheTier } from '~~/server/utils/visitorCacheTier';
import { logger } from '~~/server/utils/logger';

/**
 * Response headers every rendered page needs, which neither `routeRules` nor
 * nuxt-security can express.
 *
 * **`Cache-Control`** — who may STORE this response, decided from the request's
 * cookies by `visitorCacheTier`. Three tiers, and the reasoning behind each:
 *
 * - Every tier gets `private` in `Cache-Control`. That is the conservative
 *   default and it stays: `security.nonce` stamps a per-request nonce into both
 *   the CSP header and the inline scripts of every page, so an intermediary that
 *   stored one visitor's response and replayed it to another would serve a nonce
 *   that no longer matches, and the browser would block every inline script --
 *   the app does not boot. `private` is what tells generic caches not to try.
 *
 * - The `shared` tier additionally gets `CDN-Cache-Control`, which only a CDN
 *   reads and which Cloudflare gives precedence over `Cache-Control`. A CDN is
 *   safe where a generic proxy is not, because it stores headers and body as one
 *   object: a replayed hit serves the nonce that matches its own body. What that
 *   costs is the nonce's per-request uniqueness within the TTL, which is a real
 *   but modest weakening and the same trade Shirabe makes in `cache_publicly`.
 *
 * Deliberately no browser `max-age` on any tier. It would be the obvious
 * addition and it is the wrong one here: `identity-auth` now trusts the payload's
 * `nd-ssr-identity-check` instead of re-checking the session on every load, so a
 * page the browser replays from its own cache after the reader signed in
 * elsewhere would keep rendering signed-out chrome with nothing to correct it.
 * The session cookie is httpOnly, so the client cannot notice on its own. A
 * browser TTL becomes safe once a client-readable session marker exists; until
 * then the CDN tier carries the win and the browser revalidates.
 *
 * **This is only the origin half.** Nothing is actually shared until a Cloudflare
 * Cache Rule marks these paths eligible AND bypasses on the session and
 * preference cookies -- Cloudflare does not cache HTML by default, so shipping
 * the header first is inert and safe. `X-Nd-Cache-Tier` is emitted so that rule
 * can be written and verified against what the origin actually decided.
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

  const tier = visitorCacheTier(event);

  // Emitted on every tier, not just the cacheable one: this is what makes the
  // share of shared-tier traffic countable, which is the number that decides
  // whether edge-caching search is worth doing at all. It is also what a
  // Cloudflare rule can be checked against.
  setResponseHeader(event, 'X-Nd-Cache-Tier', tier);

  // A route that already said something about caching means it. `/` is
  // `private, no-store` from the locale router and must stay that way.
  if (getResponseHeader(event, 'Cache-Control')) return;

  // `no-cache` means "store it, but revalidate before reuse" -- NOT "do not
  // store". It is what the paragraph above already claims happens ("the browser
  // revalidates"), and bare `private` did not deliver it: with no `max-age` and
  // no `Expires`, a response is heuristically cacheable, so the browser is free
  // to reuse this HTML without asking. That is the stale shell that leaves a
  // reader asking for `/_nuxt/<hash>.js` files the live build no longer has, and
  // it also defeats the recovery in `app/plugins/chunkReload.client.ts`: the
  // reload is served the same cached HTML and fails the same way, twice, until
  // the attempt budget runs out.
  //
  // Still no `max-age`, so the reasoning above about `nd-ssr-identity-check` is
  // untouched -- this only forces the revalidation that was already assumed.
  // A 304 costs a round trip and no body.
  setResponseHeader(event, 'Cache-Control', 'private, no-cache');

  // Both tests have to pass: the right kind of visitor asking for the right kind
  // of page. `htmlPathIsShareable` keeps the account and collection screens out
  // regardless of how anonymous the request looks.
  //
  // Recorded rather than emitted, because the third test cannot be run yet. This
  // middleware is upstream of the render, so the status code does not exist here,
  // and a `CDN-Cache-Control` written now would ride out on a 500 as happily as on
  // a page -- handing the edge a server error to serve to everyone for the next
  // five minutes. `server/plugins/02-shared-cache-header.ts` emits it once the
  // status is known.
  if (tier === 'shared' && htmlPathIsShareable(path)) {
    event.context.ndShareable = true;
  }

  if (import.meta.dev) {
    logger.debug({ path, tier }, 'html cache tier');
  }
});
