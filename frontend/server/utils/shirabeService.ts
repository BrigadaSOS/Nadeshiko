import type { H3Event } from 'h3';
import { buildInternalBackendHeaders, internalBackendUrl } from '~~/server/utils/internalBackend';

/**
 * Gets the short-lived OAuth bearer for Nadeshiko's shared Shirabe stack.
 *
 * Nitro never holds the OAuth client secret. The backend owns it, mints and
 * caches client-credentials tokens through the generated Shirabe SDK, then
 * hands this server-only route a bearer with only `dictionary:read`.
 */
type ServiceCredential = { token: string; expiresAt: number; refreshAt: number };

let cached: ServiceCredential | null = null;
let pending: Promise<string> | null = null;
let retryAt = 0;

function usable(credential: ServiceCredential | null): credential is ServiceCredential {
  return Boolean(credential && credential.expiresAt > Date.now() &&
    (credential.refreshAt > Date.now() || retryAt > Date.now()));
}

/**
 * Gets the shared-dictionary bearer without exposing it to a browser. The
 * backend returns both actual expiry and the next renewal time, letting Nitro
 * coalesce lookups and keep a valid token through a brief backend outage.
 */
export async function shirabeServiceToken(event?: H3Event): Promise<string> {
  if (usable(cached)) return cached.token;
  pending ??= requestServiceToken(event).catch((error: unknown) => {
    if (!cached || cached.expiresAt <= Date.now()) throw error;
    retryAt = Math.min(cached.expiresAt, Date.now() + 60_000);
    return cached.token;
  }).finally(() => { pending = null; });
  return pending;
}

async function requestServiceToken(event?: H3Event): Promise<string> {
  const config = useRuntimeConfig();
  const credential = await $fetch<ServiceCredential>(
    internalBackendUrl(config, '/v1/user/connections/shirabe/service-credential'),
    {
      headers: buildInternalBackendHeaders(config, {}, event),
      timeout: 2000,
    },
  );

  if (!credential?.token || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= Date.now() ||
      !Number.isFinite(credential.refreshAt) || credential.refreshAt > credential.expiresAt) {
    throw createError({ statusCode: 503, statusMessage: 'Shirabe lookups are not configured' });
  }
  cached = credential;
  retryAt = 0;
  return credential.token;
}

export const __testing = {
  reset: () => {
    cached = null;
    pending = null;
    retryAt = 0;
  },
};
