import { describe, it, expect } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { InvalidRequestError } from '@app/errors';
import { encodeKeysetCursor } from '@lib/cursor';
import {
  buildRound,
  compareSortValues,
  decodeVarietyCursor,
  encodeRestCursor,
  encodeRoundsCursor,
  indexAfterCursor,
  shouldDiversify,
  type RoundEntry,
  type RoundsCursor,
} from '@app/services/search/segmentDocument/variety';

// The relevance sort with its stable tie-breakers: score desc, then ascending.
const SORT: estypes.Sort = [
  { _score: { order: 'desc' } },
  { characterCount: { order: 'asc' } },
  { mediaId: { order: 'asc' } },
  { episode: { order: 'asc' } },
  { position: { order: 'asc' } },
];
const SORT_LENGTH = 5;
const NO_FILTERS = {} as never;

/** A collapse response without inner hits: one top-level hit per title, in sort order, title from doc values. */
function collapsed(hits: Array<{ id: string; score: number; media: number }>): estypes.SearchResponse {
  return {
    hits: {
      hits: hits.map((hit) => ({
        _index: 'i',
        _id: hit.id,
        fields: { mediaId: [hit.media] },
        sort: [hit.score, 10, hit.media, 1, Number(hit.id)],
      })),
    },
  } as unknown as estypes.SearchResponse;
}

const roundsCursor = (round: number, sort: estypes.FieldValue[]): RoundsCursor => ({
  kind: 'variety',
  block: 'all',
  phase: 'rounds',
  round,
  sort,
});

describe('shouldDiversify', () => {
  it('applies to the default order with a search word', () => {
    expect(shouldDiversify({}, NO_FILTERS, true)).toBe(true);
    expect(shouldDiversify({ sort: { mode: 'RELEVANCE' } } as never, NO_FILTERS, true)).toBe(true);
  });

  it('leaves an explicit sort alone', () => {
    for (const mode of ['asc', 'desc', 'time_asc', 'time_desc', 'difficulty_asc', 'difficulty_desc', 'random']) {
      expect(shouldDiversify({ sort: { mode } } as never, NO_FILTERS, true)).toBe(false);
    }
  });

  it('does nothing without a word or inside a single title', () => {
    expect(shouldDiversify({}, NO_FILTERS, false)).toBe(false);
    expect(shouldDiversify({}, { media: { include: [{ mediaPublicId: 'x' }] } } as never, true)).toBe(false);
    expect(
      shouldDiversify({}, { media: { include: [{ mediaPublicId: 'x' }, { mediaPublicId: 'y' }] } } as never, true),
    ).toBe(true);
  });
});

describe('compareSortValues', () => {
  const compare = compareSortValues(SORT);

  it('follows each field direction', () => {
    expect(compare([2, 10, 1, 1, 1], [1, 10, 1, 1, 1])).toBeLessThan(0); // higher score first
    expect(compare([1, 5, 1, 1, 1], [1, 10, 1, 1, 1])).toBeLessThan(0); // shorter first
    expect(compare([1, 10, 1, 1, 1], [1, 10, 1, 1, 1])).toBe(0);
  });
});

describe('buildRound', () => {
  it("keeps the collapse's order and tags each entry with its title and round", () => {
    const entries = buildRound(
      collapsed([
        { id: '1', score: 9, media: 1 },
        { id: '5', score: 7, media: 3 },
        { id: '3', score: 5, media: 2 },
      ]),
      1,
    );

    expect(entries.map((e) => [e.id, e.mediaId, e.round])).toEqual([
      ['1', 1, 1],
      ['5', 3, 1],
      ['3', 2, 1],
    ]);
    expect(entries[0]?.sort).toEqual([9, 10, 1, 1, 1]);
  });

  it('drops an excluded sentence, leaving its title without an entry in that round', () => {
    // A recurring opening's later copy in round 2: that title's other lines arrive in the rest.
    const entries = buildRound(
      collapsed([
        { id: '2', score: 9, media: 1 },
        { id: '4', score: 3, media: 2 },
      ]),
      2,
      new Set(['2']),
    );
    expect(entries.map((e) => [e.id, e.round])).toEqual([['4', 2]]);
  });

  it('reads the title from the source when doc values are absent', () => {
    const response = {
      hits: { hits: [{ _index: 'i', _id: '7', _source: { mediaId: 4 }, sort: [1, 1, 4, 1, 7] }] },
    } as unknown as estypes.SearchResponse;
    expect(buildRound(response, 1).map((e) => e.mediaId)).toEqual([4]);
  });
});
describe('indexAfterCursor', () => {
  const rounds: RoundEntry[] = [
    { id: '1', mediaId: 1, round: 1, sort: [9, 10, 1, 1, 1] },
    { id: '5', mediaId: 3, round: 1, sort: [7, 10, 3, 1, 5] },
    { id: '2', mediaId: 1, round: 2, sort: [8, 10, 1, 1, 2] },
  ];

  it('continues right after the last entry shown', () => {
    expect(indexAfterCursor(rounds, roundsCursor(1, [9, 10, 1, 1, 1]), SORT)).toBe(1);
    expect(indexAfterCursor(rounds, roundsCursor(1, [7, 10, 3, 1, 5]), SORT)).toBe(2);
    expect(indexAfterCursor(rounds, roundsCursor(2, [8, 10, 1, 1, 2]), SORT)).toBe(3);
  });

  it('never goes back to an entry already shown when the list changed underneath', () => {
    // The entry the cursor points at is gone; the next one after its position is still the answer.
    expect(indexAfterCursor(rounds, roundsCursor(1, [8, 10, 2, 1, 1]), SORT)).toBe(1);
  });
});

describe('variety cursors', () => {
  it('round-trips both phases and both blocks', () => {
    const entry: RoundEntry = { id: '1', mediaId: 1, round: 2, sort: [1.5, 10, 1, 1, 1] };
    expect(decodeVarietyCursor(encodeRoundsCursor('fav', entry), SORT_LENGTH)).toEqual({
      kind: 'variety',
      block: 'fav',
      phase: 'rounds',
      round: 2,
      sort: [1.5, 10, 1, 1, 1],
    });
    expect(decodeVarietyCursor(encodeRestCursor('all', [1, 2, 3, 4, 5]), SORT_LENGTH)).toEqual({
      kind: 'variety',
      block: 'all',
      phase: 'rest',
      after: [1, 2, 3, 4, 5],
    });
  });

  it('recognises a keyset cursor from before rounds existed', () => {
    expect(decodeVarietyCursor(encodeKeysetCursor([1, 2, 3]), SORT_LENGTH)).toBe('keyset');
    expect(decodeVarietyCursor(undefined, SORT_LENGTH)).toBeUndefined();
  });

  it('rejects a cursor that does not match the sort, rather than sending it to Elasticsearch', () => {
    expect(() => decodeVarietyCursor(encodeRestCursor('all', [1, 2]), SORT_LENGTH)).toThrow(InvalidRequestError);
    const shortRounds = encodeRoundsCursor('all', { id: '1', mediaId: 1, round: 1, sort: [1] });
    expect(() => decodeVarietyCursor(shortRounds, SORT_LENGTH)).toThrow(InvalidRequestError);
  });

  it('rejects anything else', () => {
    expect(() => decodeVarietyCursor('not-base64-json', SORT_LENGTH)).toThrow(InvalidRequestError);
    const sideways = Buffer.from(JSON.stringify({ kind: 'variety', block: 'all', phase: 'sideways' })).toString(
      'base64url',
    );
    expect(() => decodeVarietyCursor(sideways, SORT_LENGTH)).toThrow(InvalidRequestError);
    const noBlock = Buffer.from(JSON.stringify({ kind: 'variety', phase: 'rest', after: null })).toString('base64url');
    expect(() => decodeVarietyCursor(noBlock, SORT_LENGTH)).toThrow(InvalidRequestError);
  });
});
