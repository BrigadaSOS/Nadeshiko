import { createLogger } from '../utils/logger';

const logger = createLogger('nitro:boot');

export default defineNitroPlugin(() => {
  if (import.meta.prerender) {
    return;
  }

  const config = useRuntimeConfig();

  const missing: string[] = [];
  if (!config.backendInternalUrl) missing.push('NUXT_BACKEND_INTERNAL_URL');
  if (!config.nadeshikoApiKey) missing.push('NUXT_NADESHIKO_API_KEY');

  // Without the shared secret every proxied and SSR request lands in the
  // backend's per-IP rate bucket for this host, so a deployed frontend must not
  // start without it. Local dev can run without the exemption.
  if (!String(config.internalProxySecret || '').trim()) {
    if (config.public.environment === 'local') {
      logger.warn(
        'NUXT_INTERNAL_PROXY_SECRET is not set: backend rate limiting will treat this frontend as a single client IP.',
      );
    } else {
      missing.push('NUXT_INTERNAL_PROXY_SECRET');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
});
