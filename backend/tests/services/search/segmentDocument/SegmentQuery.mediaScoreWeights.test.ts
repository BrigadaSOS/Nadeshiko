import { describe, it, expect } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { PREFERRED_MEDIA_SCORE_WEIGHT, SegmentQuery } from '@app/services/search/segmentDocument/SegmentQuery';

/** Stands in for whatever the rest of the builder assembled; the wrap must not care. */
const innerQuery: estypes.QueryDslQueryContainer = {
  bool: { must: [{ match: { textJa: 'ねこ' } }], filter: [{ terms: { status: ['ACTIVE'] } }] },
};

/**
 * The client's `QueryDslQueryContainer` is an `ExactlyOne<...>` union that admits
 * `undefined`, so every use below would otherwise need its own null check for a
 * value the builder never returns.
 */
const wrap = (weights: { demoted?: Map<number, number>; preferred?: Set<number> }) =>
  SegmentQuery.applyMediaScoreWeights(innerQuery, weights)!;

const scoring = (weights: { demoted?: Map<number, number>; preferred?: Set<number> }) => {
  const scored = wrap(weights).function_score as estypes.QueryDslFunctionScoreQuery;
  expect(scored).toBeDefined();
  return scored;
};

/** The clauses as `[weight, mediaIds]`, which is what every case here is about. */
const clauses = (weights: { demoted?: Map<number, number>; preferred?: Set<number> }) =>
  (scoring(weights).functions ?? []).map((fn) => [fn.weight, (fn.filter as any).terms.mediaId]);

describe('applyMediaScoreWeights', () => {
  it('returns the query untouched when no title has a weight', () => {
    // Identity by reference, not just by value: the empty case is the common one,
    // and it must not put a function_score between the query and Elasticsearch.
    expect(wrap({})).toBe(innerQuery);
    expect(wrap({ demoted: new Map(), preferred: new Set() })).toBe(innerQuery);
  });

  it('multiplies the assembled score down for demoted titles', () => {
    const scored = scoring({ demoted: new Map([[7, 0.35]]) });

    expect(scored.query).toBe(innerQuery);
    expect(scored.functions).toEqual([{ filter: { terms: { mediaId: [7] } }, weight: 0.35 }]);
    // Both modes have to be multiply: `replace` would discard relevance entirely,
    // and `sum` would *raise* the score of exactly the titles being demoted.
    expect(scored.score_mode).toBe('multiply');
    expect(scored.boost_mode).toBe('multiply');
  });

  it('emits one clause per distinct weight, not one per title', () => {
    // The catalogue can hold far more reported titles than there are tiers, and a
    // clause each would put every one of them in the query separately.
    const demoted = new Map([
      [7, 0.35],
      [12, 0.2],
      [3, 0.35],
      [9, 0.2],
    ]);

    expect(clauses({ demoted })).toEqual([
      [0.2, [9, 12]],
      [0.35, [3, 7]],
    ]);
  });

  it('boosts the reader’s own titles', () => {
    expect(clauses({ preferred: new Set([4, 1]) })).toEqual([[PREFERRED_MEDIA_SCORE_WEIGHT, [4, 1]]]);
  });

  it('softens but never rescues a preferred title that is also demoted', () => {
    // Both clauses match, and multiply means the product applies. The assertion
    // that matters is the product, not the clauses: a favourite must not be able
    // to buy its way back to full ranking.
    const [demotion] = clauses({ demoted: new Map([[7, 0.35]]), preferred: new Set([7]) });

    expect(Number(demotion?.[0]) * PREFERRED_MEDIA_SCORE_WEIGHT).toBeLessThan(1);
  });

  it('demotes without excluding', () => {
    // A demoted title still matches; it just scores lower -- unlike a reported
    // segment, which is dropped outright. The wrap contributes nothing but the
    // function_score (no sibling clause that could turn a penalty into a removal)
    // and weights strictly inside (0, 1), so a search for something only that
    // title contains still finds it.
    expect(Object.keys(wrap({ demoted: new Map([[7, 0.35]]) }))).toEqual(['function_score']);
    expect(PREFERRED_MEDIA_SCORE_WEIGHT).toBeGreaterThan(1);
  });
});
