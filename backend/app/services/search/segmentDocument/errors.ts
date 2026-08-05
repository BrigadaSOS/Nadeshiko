import type { estypes } from '@elastic/elasticsearch';
import { logger } from '@config/log';
import type { QueryParserMode } from './SegmentQuery';

/**
 * `_msearch` reports per-sub-search failures in-band: a failed item still carries a
 * `status` (400, 503, ...) plus an `error`, and has no `hits`/`aggregations`. Only a 2xx
 * item may be read as a search response body.
 */
export function isSuccessfulMsearchItem(
  response: estypes.MsearchResponseItem | undefined,
): response is estypes.MsearchMultiSearchItem {
  if (!response || 'error' in response) return false;

  const { status } = response;
  return status === undefined || (status >= 200 && status < 300);
}

export function isQuerySyntaxError(error: unknown): boolean {
  const elasticError = error as {
    message?: string;
    meta?: {
      body?: {
        error?: {
          type?: string;
          reason?: string;
          root_cause?: Array<{ type?: string; reason?: string }>;
          failed_shards?: Array<{ reason?: { type?: string; reason?: string } }>;
        };
      };
    };
  };

  const errorMeta = elasticError.meta?.body?.error;
  const errorCauses = [
    { type: errorMeta?.type, reason: errorMeta?.reason },
    ...(errorMeta?.root_cause ?? []),
    ...(errorMeta?.failed_shards?.map((item) => item.reason ?? {}) ?? []),
  ];

  if (errorCauses.some((cause) => cause.type === 'parse_exception' || cause.type === 'parsing_exception')) {
    return true;
  }

  const message = [elasticError.message, ...errorCauses.map((cause) => cause.reason)].join(' ').toLowerCase();
  return (
    message.includes('failed to parse query') ||
    message.includes('cannot parse') ||
    message.includes('lexical error') ||
    message.includes('token_mgr_error')
  );
}

export async function withSafeQueryFallback<T>(
  fn: () => Promise<T>,
  retry: () => Promise<T>,
  opts: { parserMode: QueryParserMode; hasQuery?: boolean; warnContext: Record<string, unknown>; warnMessage: string },
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (opts.parserMode === 'strict' && (opts.hasQuery ?? true) && isQuerySyntaxError(error)) {
      logger.warn(opts.warnContext, opts.warnMessage);
      return retry();
    }
    throw error;
  }
}
