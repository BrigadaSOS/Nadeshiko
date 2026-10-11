import { describe, it, expect } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { SegmentQuery } from '@app/services/search/segmentDocument/SegmentQuery';

/** The assembled matching query must survive title weighting without new restrictions. */
const innerQuery: estypes.QueryDslQueryContainer = {
  bool: { must: [{ match: { textJa: 'ねこ' } }], filter: [{ terms: { status: ['ACTIVE'] } }] },
};

describe('applyMediaScoreWeights', () => {
  it('leaves the assembled query unwrapped when no title has a weight', () => {
    expect(SegmentQuery.applyMediaScoreWeights(structuredClone(innerQuery), {})).toEqual(innerQuery);
    expect(
      SegmentQuery.applyMediaScoreWeights(structuredClone(innerQuery), { demoted: new Map(), preferred: new Set() }),
    ).toEqual(innerQuery);
  });

  const cases: {
    label: string;
    weights: { demoted?: Map<number, number>; preferred?: Set<number> };
    functions: estypes.QueryDslFunctionScoreContainer[];
  }[] = [
    {
      label: 'demotion preserves matching without a minimum-score exclusion',
      weights: { demoted: new Map([[7, 0.35]]) },
      functions: [{ filter: { terms: { mediaId: [7] } }, weight: 0.35 }],
    },
    {
      label: 'equal penalties form one clause per tier in numeric order',
      weights: {
        demoted: new Map([
          [7, 0.35],
          [12, 0.2],
          [3, 0.35],
          [9, 0.2],
        ]),
      },
      functions: [
        { filter: { terms: { mediaId: [9, 12] } }, weight: 0.2 },
        { filter: { terms: { mediaId: [3, 7] } }, weight: 0.35 },
      ],
    },
    {
      label: 'preferences alone boost the selected titles',
      weights: { preferred: new Set([4, 1]) },
      functions: [{ filter: { terms: { mediaId: [4, 1] } }, weight: 1.15 }],
    },
    {
      label: 'preferences and penalties compose for the same title',
      weights: { demoted: new Map([[7, 0.35]]), preferred: new Set([7]) },
      functions: [
        { filter: { terms: { mediaId: [7] } }, weight: 0.35 },
        { filter: { terms: { mediaId: [7] } }, weight: 1.15 },
      ],
    },
  ];

  it.each(cases)('$label', ({ weights, functions }) => {
    expect(SegmentQuery.applyMediaScoreWeights(structuredClone(innerQuery), weights)).toEqual({
      function_score: { query: innerQuery, functions, score_mode: 'multiply', boost_mode: 'multiply' },
    });
  });
});
