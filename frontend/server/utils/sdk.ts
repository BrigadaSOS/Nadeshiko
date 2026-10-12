import type { H3Event } from 'h3';
import type { NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';
import { trafficHeaders } from '#shared/utils/traffic';
import { publicApiRoutes } from '~~/server/utils/generated/publicApiRoutes';

// Never forward visitor cookies: these Nitro routes share/cache responses, so owner-scoped calls must fail closed.
// Pass the event to attribute internal calls to the requesting reader/crawler.
export function useServerSdk(event?: H3Event): NadeshikoClient {
  return createInternalSdk(useRuntimeConfig(), {
    publicRoutes: publicApiRoutes,
    headers: trafficHeaders(event),
  });
}
