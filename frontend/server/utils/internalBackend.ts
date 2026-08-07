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
import { BOT_FAMILY_HEADER, TRAFFIC_HEADER, trafficHeaders } from '#shared/utils/traffic';

const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';

/** Structural, matching `trafficHeaders`: this module is bundled into both the
 *  Nitro build and the SSR app build, so it avoids importing h3's types. */
type TrafficEvent = Parameters<typeof trafficHeaders>[0];

export type InternalBackendConfig = {
  backendInternalUrl?: unknown;
  backendHostHeader?: unknown;
  internalProxySecret?: unknown;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function getBackendInternalBaseUrl(config: InternalBackendConfig): string {
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
 *
 * When an event is given, the visitor's reader/bot/monitor classification rides
 * along on the same secret: the backend trusts `x-nadeshiko-traffic` only from
 * requests that prove they came from us, and needs it because the internal call
 * does not otherwise carry the visitor's identity. The traffic headers are
 * stripped first for the same reason the secret is — an outside client must not
 * be able to relabel its own traffic.
 */
export function buildInternalBackendHeaders(
  config: InternalBackendConfig,
  headers: Record<string, string> = {},
  event?: TrafficEvent,
): Record<string, string> {
  if (config.backendHostHeader) {
    headers.host = String(config.backendHostHeader);
  }

  delete headers[INTERNAL_PROXY_HEADER];
  delete headers[TRAFFIC_HEADER];
  delete headers[BOT_FAMILY_HEADER];

  const internalProxySecret = String(config.internalProxySecret || '').trim();
  if (internalProxySecret) {
    headers[INTERNAL_PROXY_HEADER] = internalProxySecret;
  }

  if (event) {
    Object.assign(headers, trafficHeaders(event));
  }

  return headers;
}
