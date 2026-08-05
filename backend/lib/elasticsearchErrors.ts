import { errors } from '@elastic/elasticsearch';

/**
 * Elasticsearch failures come back in two shapes, and only one of them carries
 * a status code.
 *
 * A `ResponseError` means the cluster answered and refused — those have a status
 * code. A `ConnectionError`, timeout or DNS failure never reaches the cluster
 * and has no `meta` at all, so reaching for `error.meta.statusCode` on one
 * throws a TypeError that masks the real outage. These helpers keep that
 * distinction explicit instead of leaving each call site to poke at the shape.
 */

/** The bit of the error shape we depend on, for anything that isn't a real instance. */
type ElasticsearchErrorLike = {
  meta?: { statusCode?: unknown } | null;
};

function elasticsearchStatusCode(error: unknown): number | undefined {
  // The normal path: the client threw its own error type.
  if (error instanceof errors.ResponseError) {
    return error.statusCode;
  }

  // Structural fallback rather than instanceof alone. Two copies of
  // @elastic/transport in the tree would defeat the prototype check, and test
  // doubles reject with a plain `{ meta: { statusCode } }` object.
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
