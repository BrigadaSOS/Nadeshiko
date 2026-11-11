import { describe, it, expect } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { InvalidRequestError } from '@app/errors';
import { encodeKeysetCursor } from '@lib/cursor';
import {
  buildRounds,
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

/** A collapse response: one group per title, each with its candidate sentences in order. */
function collapsed(groups: Array<Array<{ id: string; score: number; media: number }>>): estypes.SearchResponse {
  return {
    hits: {
      hits: groups.map((inner) => ({
        _index: 'i',
        _id: inner[0]?.id,
        inner_hits: {
          rounds: {
            hits: {
              hits: inner.map((hit) => ({
                _index: 'i',
                _id: hit.id,
                _source: { mediaId: hit.media },
                sort: [hit.score, 10, hit.media, 1, Number(hit.id)],
              })),
            },
          },
        },
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
    for (const mode of ['asc', 'desc', 'time_asc', 'time_desc', 'random']) {
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

describe('buildRounds', () => {
  it('takes the best of every title, then the second best of every title', () => {
    const rounds = buildRounds(
      collapsed([
        [
          { id: '1', score: 9, media: 1 },
          { id: '2', score: 8, media: 1 },
          { id: '6', score: 7.5, media: 1 },
        ],
        [
          { id: '3', score: 5, media: 2 },
          { id: '4', score: 1, media: 2 },
        ],
        [{ id: '5', score: 7, media: 3 }],
      ]),
      SORT,
    );

    // Round 1 in relevance order (9, 7, 5), then round 2 (8, 1). Title 3 has
    // only one sentence; title 1's third candidate is not a round entry.
    expect(rounds.map((r) => r.id)).toEqual(['1', '5', '3', '2', '4']);
    expect(rounds.map((r) => r.round)).toEqual([1, 1, 1, 2, 2]);
    expect(rounds.map((r) => r.mediaId)).toEqual([1, 3, 2, 1, 2]);
  });

  it("fills a dropped sentence's slot with the title's next candidate", () => {
    // A recurring opening: the episode-2 copy is excluded, the next line moves up.
    const rounds = buildRounds(
      collapsed([
        [
          { id: '1', score: 9, media: 1 },
          { id: '2', score: 9, media: 1 },
          { id: '3', score: 4, media: 1 },
        ],
      ]),
      SORT,
      new Set(['2']),
    );
    expect(rounds.map((r) => [r.id, r.round])).toEqual([
      ['1', 1],
      ['3', 2],
    ]);
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
