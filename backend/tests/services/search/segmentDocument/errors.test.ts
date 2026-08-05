import { describe, it, expect } from 'bun:test';
import type { estypes } from '@elastic/elasticsearch';
import { isSuccessfulMsearchItem } from '@app/services/search/segmentDocument/errors';

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
