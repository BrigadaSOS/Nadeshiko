/**
 * Shared plumbing for talking to the backend over the internal network.
 *
 * Both the `/v1/*` Nitro proxy and the SSR-only calls made from the Nuxt app
 * (session + preferences) go through here so every internal request is stamped
 * with the same shared secret and Host override. The helpers are deliberately
 * pure -- they take the runtime config as an argument -- because this module is
 * bundled into both the Nitro build and the SSR app build, where the auto
 * imported `useRuntimeConfig` resolves to different implementations.
 */

import { createError } from 'h3';

export const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';

export type InternalBackendConfig = {
  backendInternalUrl?: unknown;
  backendHostHeader?: unknown;
  internalProxySecret?: unknown;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

export function getBackendInternalBaseUrl(config: InternalBackendConfig): string {
  const baseUrl = String(config.backendInternalUrl || '').trim();

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing backend internal URL configuration',
    });
  }

  return normalizeBaseUrl(baseUrl);
}

export function internalBackendUrl(config: InternalBackendConfig, path: string): string {
  return `${getBackendInternalBaseUrl(config)}${path}`;
}

/**
 * Add the internal-proxy headers to `headers` (mutated in place and returned).
 *
 * The proxy secret marks the request as coming from us so the backend per-IP
 * rate limiter can exempt it. It is always overwritten (and otherwise stripped)
 * so a client can never forge it by sending the header itself.
 */
export function buildInternalBackendHeaders(
  config: InternalBackendConfig,
  headers: Record<string, string> = {},
): Record<string, string> {
  if (config.backendHostHeader) {
    headers.host = String(config.backendHostHeader);
  }

  delete headers[INTERNAL_PROXY_HEADER];
  const internalProxySecret = String(config.internalProxySecret || '').trim();
  if (internalProxySecret) {
    headers[INTERNAL_PROXY_HEADER] = internalProxySecret;
  }

  return headers;
}
