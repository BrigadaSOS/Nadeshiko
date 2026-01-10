import { createLogger } from './logger';

const log = createLogger('backend');

type FetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  params?: Record<string, unknown>;
};

export async function backendFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const config = useRuntimeConfig();
  const baseUrl = config.public.backendUrl;
  const apiKey = config.nadeshikoApiKey;

  const url = new URL(path, baseUrl);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const requestId = crypto.randomUUID();

  log.debug({
    requestId,
    method: options.method || 'GET',
    url: url.pathname + url.search,
    hasBody: !!options.body,
  }, `[BACKEND] ${options.method || 'GET'} ${url.pathname + url.search}`);

  try {
    // Use $fetch with native: true to bypass Nitro's internal routing
    const response = await $fetch<T>(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      // @ts-ignore - native option exists in Nitro's $fetch
      native: true,
    });

    log.debug({
      requestId,
      status: 'success',
    }, `[BACKEND] ${options.method || 'GET'} ${url.pathname + url.search} - OK`);

    return response;
  } catch (error: unknown) {
    const fetchError = error as { statusCode?: number; statusMessage?: string; data?: unknown; cause?: unknown; message?: string };

    // Log detailed error for debugging
    log.error({
      requestId,
      statusCode: fetchError.statusCode,
      statusMessage: fetchError.statusMessage,
      message: fetchError.message,
      cause: fetchError.cause,
      error: fetchError.data,
      url: url.origin,
    }, `[BACKEND] ${options.method || 'GET'} ${url.pathname + url.search} - ERROR: ${fetchError.statusMessage || fetchError.message || fetchError.statusCode || 'Connection failed'}`);

    throw createError({
      statusCode: fetchError.statusCode || 503,
      statusMessage: fetchError.statusMessage || fetchError.message || 'Backend request failed',
      data: fetchError.data,
    });
  }
}
