import { createClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
import type { H3Event } from 'h3';
import { createLogger } from './logger';

const log = createLogger('nadeshiko-sdk');

let cachedClient: NadeshikoClient | null = null;
let cachedBaseUrl = '';
let cachedApiKey = '';

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
    cachedClient = createClient({
      apiKey,
      baseUrl,
      ...(hostHeader ? { headers: { Host: hostHeader } } : {}),
    });

    cachedClient.client.interceptors.error.use((error, response, _request, options) => {
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

    cachedBaseUrl = baseUrl;
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

export function getUserAuthHeaders(event: H3Event): Record<string, string | null> {
  const cookie = getHeader(event, 'cookie') || '';
  return { Cookie: cookie, Authorization: null };
}
