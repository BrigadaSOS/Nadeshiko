// Pass config explicitly: Nitro and the Vue SSR bundle resolve useRuntimeConfig differently.

import { createError } from 'h3';
import { BOT_FAMILY_HEADER, TRAFFIC_HEADER, trafficHeaders } from '#shared/utils/traffic';

const INTERNAL_PROXY_HEADER = 'x-internal-proxy-auth';

// Structural type avoids importing h3 types across the Nitro/SSR bundle boundary.
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

// Mutates headers. Strip client-supplied trust/classification headers before adding our own: the backend trusts
// traffic labels and exempts proxy IPs only when the shared secret proves the caller is internal.
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
