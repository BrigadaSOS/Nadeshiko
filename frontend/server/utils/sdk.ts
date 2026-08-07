import type { H3Event } from 'h3';
import type { NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';

/**
 * The backend SDK for Nitro endpoints (sitemaps). Same client the SSR path builds.
 *
 * Pass the event where there is one: a sitemap is fetched by crawlers, so the
 * backend calls behind it belong to the crawler that asked, not to a reader.
 */
export function useServerSdk(event?: H3Event): NadeshikoClient {
  return createInternalSdk(useRuntimeConfig(), trafficHeaders(event));
}
