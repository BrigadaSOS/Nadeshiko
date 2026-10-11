import { errors } from '@elastic/elasticsearch';

/** Separate cluster responses with status codes from connection/timeout/DNS failures with no `meta`; otherwise
 * status access masks the real outage. */

/** The bit of the error shape we depend on, for anything that isn't a real instance. */
type ElasticsearchErrorLike = {
  meta?: { statusCode?: unknown } | null;
};

function elasticsearchStatusCode(error: unknown): number | undefined {
  // The normal path: the client threw its own error type.
  if (error instanceof errors.ResponseError) {
    return error.statusCode;
  }

  // Use structural fallback as well as `instanceof` for duplicate transport copies and plain test doubles.
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const statusCode = (error as ElasticsearchErrorLike).meta?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/** True only when the cluster answered with 404, not when it was unreachable. */
export function isElasticsearchNotFound(error: unknown): boolean {
  return elasticsearchStatusCode(error) === 404;
}
