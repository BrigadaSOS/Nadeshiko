import type { NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import { createInternalSdk } from '#shared/utils/backendSdk';

/** The backend SDK for Nitro endpoints (sitemaps). Same client the SSR path builds. */
export function useServerSdk(): NadeshikoClient {
  return createInternalSdk(useRuntimeConfig());
}
