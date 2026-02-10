import { createLogger } from './logger';
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';

const log = createLogger('backend');
const tracer = trace.getTracer('nadeshiko-frontend');

type FetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  params?: Record<string, unknown>;
};

export async function backendFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const method = options.method || 'GET';

  return tracer.startActiveSpan(`backendFetch ${method} ${path}`, { kind: SpanKind.CLIENT }, async (span) => {
    const config = useRuntimeConfig();
    const baseUrl = config.backendInternalUrl;
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
    span.setAttributes({
      'http.method': method,
      'http.url': url.pathname + url.search,
      'http.request_id': requestId,
    });

    log.debug(
      {
        requestId,
        method,
        url: url.pathname + url.search,
        hasBody: !!options.body,
      },
      `[BACKEND] ${method} ${url.pathname + url.search}`,
    );

    try {
      // Use $fetch with native: true to bypass Nitro's internal routing
      const response = await $fetch(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        native: true,
      });

      log.debug(
        {
          requestId,
          status: 'success',
        },
        `[BACKEND] ${method} ${url.pathname + url.search} - OK`,
      );

      span.end();
      return response as T;
    } catch (error: unknown) {
      const fetchError = error as {
        statusCode?: number;
        statusMessage?: string;
        data?: unknown;
        cause?: unknown;
        message?: string;
      };

      // Log detailed error for debugging
      log.error(
        {
          requestId,
          statusCode: fetchError.statusCode,
          statusMessage: fetchError.statusMessage,
          message: fetchError.message,
          cause: fetchError.cause,
          error: fetchError.data,
          url: url.origin,
        },
        `[BACKEND] ${method} ${url.pathname + url.search} - ERROR: ${fetchError.statusMessage || fetchError.message || fetchError.statusCode || 'Connection failed'}`,
      );

      span.setAttribute('http.status_code', fetchError.statusCode || 503);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();

      throw createError({
        statusCode: fetchError.statusCode || 503,
        statusMessage: fetchError.statusMessage || fetchError.message || 'Backend request failed',
        data: fetchError.data,
      });
    }
  });
}
