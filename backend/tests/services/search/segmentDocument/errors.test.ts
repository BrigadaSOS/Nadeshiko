import { describe, it, expect, vi } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { isSuccessfulMsearchItem, withSafeQueryFallback } from '@app/services/search/segmentDocument/errors';

const asItem = (value: unknown) => value as estypes.MsearchResponseItem;

describe('isSuccessfulMsearchItem', () => {
  it('accepts a 2xx sub-search', () => {
    expect(isSuccessfulMsearchItem(asItem({ status: 200, hits: { hits: [] } }))).toBe(true);
  });

  it('accepts a sub-search that omits status', () => {
    expect(isSuccessfulMsearchItem(asItem({ hits: { hits: [] } }))).toBe(true);
  });

  it('rejects client and server errors', () => {
    expect(isSuccessfulMsearchItem(asItem({ status: 400, error: { type: 'parsing_exception' } }))).toBe(false);
    expect(isSuccessfulMsearchItem(asItem({ status: 503, error: { type: 'search_phase_execution_exception' } }))).toBe(
      false,
    );
  });

  it('rejects an item carrying an error even with a 2xx status', () => {
    expect(isSuccessfulMsearchItem(asItem({ status: 200, error: { type: 'illegal_argument_exception' } }))).toBe(false);
  });

  it('rejects a missing sub-search', () => {
    expect(isSuccessfulMsearchItem(undefined)).toBe(false);
  });
});

/**
 * The shape the Elasticsearch client hands us: root causes are formatted into
 * `message` as well as kept structured under `meta.body.error`, so a classifier
 * reading either one sees them.
 */
const esError = (type: string, reason: string) =>
  Object.assign(new Error(`search_phase_execution_exception\n\tRoot causes:\n\t\t${type}: ${reason}`), {
    meta: { body: { error: { type: 'search_phase_execution_exception', root_cause: [{ type, reason }] } } },
  });

describe('withSafeQueryFallback', () => {
  const opts = (over: Partial<Parameters<typeof withSafeQueryFallback>[2]> = {}) => ({
    parserMode: 'strict' as const,
    warnContext: {},
    warnMessage: 'retrying',
    ...over,
  });

  it('returns the first result when nothing fails', async () => {
    const retry = vi.fn();
    await expect(withSafeQueryFallback(async () => 'ok', retry, opts())).resolves.toBe('ok');
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a tilde query that the shard could not build', async () => {
    // `本好きの下剋上 ~司書に…~ 第一部` -- query_string reads the tilde as a
    // fuzziness modifier and the shard rejects the phrase that follows it.
    const error = esError('query_shard_exception', 'failed to create query: fuzziness cannot be [第一部]');

    await expect(
      withSafeQueryFallback(
        () => Promise.reject(error),
        async () => 'safe',
        opts(),
      ),
    ).resolves.toBe('safe');
  });

  it('retries the parse failures it already covered', async () => {
    const causes = [
      esError('parsing_exception', "Encountered ' <RANGEEX_GOOP> '"),
      esError('query_shard_exception', 'Failed to parse query [foo AND]'),
      esError('illegal_argument_exception', 'TokenMgrError: Lexical error at line 1'),
    ];

    for (const error of causes) {
      await expect(
        withSafeQueryFallback(
          () => Promise.reject(error),
          async () => 'safe',
          opts(),
        ),
      ).resolves.toBe('safe');
    }
  });

  it('rethrows a failure that a different parser would not fix', async () => {
    const error = esError('circuit_breaking_exception', '[parent] Data too large');

    await expect(
      withSafeQueryFallback(
        () => Promise.reject(error),
        async () => 'safe',
        opts(),
      ),
    ).rejects.toBe(error);
  });

  it('does not retry a search that already ran through the safe parser', async () => {
    const error = esError('query_shard_exception', 'failed to create query: fuzziness cannot be [第一部]');
    const retry = vi.fn();

    await expect(withSafeQueryFallback(() => Promise.reject(error), retry, opts({ parserMode: 'safe' }))).rejects.toBe(
      error,
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not retry when there was no query to reparse', async () => {
    const error = esError('query_shard_exception', 'failed to create query: fuzziness cannot be [第一部]');
    const retry = vi.fn();

    await expect(withSafeQueryFallback(() => Promise.reject(error), retry, opts({ hasQuery: false }))).rejects.toBe(
      error,
    );
    expect(retry).not.toHaveBeenCalled();
  });
});
