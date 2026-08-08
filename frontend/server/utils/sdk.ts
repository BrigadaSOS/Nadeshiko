import type { H3Event } from 'h3';
import type { NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';

/**
 * The backend SDK for Nitro endpoints (sitemaps, the cached `/api/*` routes).
 *
 * Pass the event where there is one: a sitemap is fetched by crawlers, so the
 * backend calls behind it belong to the crawler that asked, not to a reader.
 *
 * **No visitor cookie, deliberately.** The SSR client forwards one so an
 * owner-scoped page can authenticate as its reader; these routes must not. Their
 * responses are shared — several are `swr`-cached in `nuxt.config.ts` — and a
 * cookie-authenticated response stored in a shared cache is served to the next
 * visitor. Without a cookie an owner-scoped call from here simply 401s, which is
 * the right failure for a route whose answer is supposed to be the same for
 * everyone.
 */
export function useServerSdk(event?: H3Event): NadeshikoClient {
  return createInternalSdk(useRuntimeConfig(), {
    publicRoutes: publicApiRoutes,
    headers: trafficHeaders(event),
  });
}
