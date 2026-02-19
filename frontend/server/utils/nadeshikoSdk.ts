import { createClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type { H3Event } from 'h3';
import { createLogger } from './logger';

const log = createLogger('nadeshiko-sdk');

let cachedClient: NadeshikoClient | null = null;
let cachedBaseUrl = '';
let cachedApiKey = '';

function applyInterceptors(sdkClient: NadeshikoClient, hostHeader: string) {
  if (hostHeader) {
    sdkClient.client.interceptors.request.use((request) => {
      request.headers.set('Host', hostHeader);
      return request;
    });
  }

  sdkClient.client.interceptors.error.use((error, response, _request, options) => {
    const err = error as Record<string, unknown> | undefined;
    const statusCode = (typeof err?.status === 'number' && err.status) || response?.status || 503;
    const statusMessage =
      (typeof err?.title === 'string' && err.title) ||
      (typeof err?.message === 'string' && err.message) ||
      `SDK request failed: ${options.url}`;

    log.error(
      {
        url: options.url,
        statusCode,
        statusMessage,
        error,
      },
      `[SDK] ${options.url} failed`,
    );

    throw createError({
      statusCode,
      statusMessage,
      data: err ? { status: err.status, title: err.title, message: err.message } : undefined,
    });
  });
}

/**
 * Returns a cached SDK client authenticated with the server-level API key.
 * Use for endpoints that accept Bearer token auth (media, search, admin).
 */
export function getNadeshikoSdkClient(): NadeshikoClient {
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '');
  const apiKey = String(config.nadeshikoApiKey || '');

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing backend URL configuration',
    });
  }

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing Nadeshiko API key configuration',
    });
  }

  if (!cachedClient || cachedBaseUrl !== baseUrl || cachedApiKey !== apiKey) {
    const hostHeader = String(config.backendHostHeader || '');
    cachedClient = createClient({ apiKey, baseUrl });
    applyInterceptors(cachedClient, hostHeader);
    cachedBaseUrl = baseUrl;
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

/**
 * Returns a per-request SDK client authenticated with the user's session cookie.
 * Use for user-specific endpoints (/v1/user/*, /v1/collections/*, etc.).
 */
export function getNadeshikoUserClient(event: H3Event): NadeshikoClient {
  const config = useRuntimeConfig();
  const baseUrl = String(config.backendInternalUrl || '');
  const hostHeader = String(config.backendHostHeader || '');
  const sessionToken = getCookie(event, 'nadeshiko.session_token') ?? '';

  if (!baseUrl) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Missing backend URL configuration',
    });
  }

  const userClient = createClient({ sessionToken, baseUrl });
  applyInterceptors(userClient, hostHeader);
  return userClient;
}
