import { createClient, type NadeshikoClient } from '@brigadasos/nadeshiko-sdk';
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
    cachedClient = createClient({
      apiKey,
      baseUrl,
    });
    cachedBaseUrl = baseUrl;
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

type SdkResult<T> = {
  data?: T;
  error?: unknown;
  response?: Response;
};

export function unwrapSdkResult<T>(operation: string, result: SdkResult<T>): T {
  if (result.error !== undefined || result.data === undefined) {
    const error = result.error as Record<string, unknown> | undefined;
    const statusCode = (typeof error?.status === 'number' && error.status) || result.response?.status || 503;
    const statusMessage =
      (typeof error?.title === 'string' && error.title) ||
      (typeof error?.message === 'string' && error.message) ||
      `SDK request failed: ${operation}`;

    log.error(
      {
        operation,
        statusCode,
        statusMessage,
        error: result.error,
      },
      `[SDK] ${operation} failed`,
    );

    throw createError({
      statusCode,
      statusMessage,
      data: result.error,
    });
  }

  return result.data;
}
