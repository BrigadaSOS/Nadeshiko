import { describe, it, expect } from 'vitest';
import {
  buildCommonFilters,
  buildMediaFilter,
  expandContentRatingTerms,
} from '@app/services/search/segmentDocument/filterRegistry';

/**
 * Pins the exact Elasticsearch clauses each request filter produces.
 *
 * These assertions are deliberately literal rather than structural. The built
 * query is hashed into the search-stats cache key, so a change that is
 * semantically equivalent but differently shaped still invalidates every cached
 * entry -- and a change that is *not* equivalent silently returns different
 * search results, which no higher-level test would notice.
 */

const STATUS = ['ACTIVE'];
const base = (extra: object = {}) => ({ status: STATUS, ...extra }) as never;

describe('buildCommonFilters', () => {
  it('always scopes to the status set', () => {
    expect(buildCommonFilters(base())).toEqual({
      filter: [{ terms: { status: ['ACTIVE'] } }],
      must_not: [],
    });
  });

  it('emits clauses in a fixed order, since the order feeds the stats cache key', () => {
    const { filter } = buildCommonFilters(
      base({
        segmentLengthChars: { min: 1, max: 2 },
        segmentDurationMs: { min: 3, max: 4 },
        media: { include: [{ mediaPublicId: 'p', mediaId: 7 }] },
        contentRating: ['SAFE'],
        category: ['ANIME'],
      }),
    );

    expect(filter.map((clause) => Object.keys(clause ?? {})[0])).toEqual([
      'terms',
      'range',
      'range',
      'bool',
      'terms',
      'terms',
    ]);
  });

  describe('range filters', () => {
    it('maps segmentLengthChars to characterCount', () => {
      expect(buildCommonFilters(base({ segmentLengthChars: { min: 5, max: 50 } })).filter[1]).toEqual({
        range: { characterCount: { gte: 5, lte: 50 } },
      });
    });

    it('maps segmentDurationMs to durationMs', () => {
      expect(buildCommonFilters(base({ segmentDurationMs: { min: 5, max: 50 } })).filter[1]).toEqual({
        range: { durationMs: { gte: 5, lte: 50 } },
      });
    });

    it('omits the bound that was not given', () => {
      expect(buildCommonFilters(base({ segmentLengthChars: { min: 5 } })).filter[1]).toEqual({
        range: { characterCount: { gte: 5 } },
      });
      expect(buildCommonFilters(base({ segmentLengthChars: { max: 5 } })).filter[1]).toEqual({
        range: { characterCount: { lte: 5 } },
      });
    });

    it('keeps a bound of zero, which truthiness would drop', () => {
      expect(buildCommonFilters(base({ segmentDurationMs: { min: 0, max: 0 } })).filter[1]).toEqual({
        range: { durationMs: { gte: 0, lte: 0 } },
      });
    });

    it('adds no clause when neither bound is given', () => {
      expect(buildCommonFilters(base({ segmentLengthChars: {} })).filter).toHaveLength(1);
    });
  });

  describe('media filters', () => {
    it('puts include in filter and exclude in must_not', () => {
      const result = buildCommonFilters(
        base({
          media: {
            include: [{ mediaPublicId: 'a', mediaId: 1 }],
            exclude: [{ mediaPublicId: 'b', mediaId: 2 }],
          },
        }),
      );

      expect(result.filter[1]).toEqual({
        bool: { should: [{ bool: { must: [{ term: { mediaId: { value: 1 } } }] } }] },
      });
      expect(result.must_not).toEqual([
        { bool: { should: [{ bool: { must: [{ term: { mediaId: { value: 2 } } }] } }] } },
      ]);
    });

    it('matches on the resolved internal id, not the public one', () => {
      // The wire shape carries mediaPublicId; only mediaId is ever queried.
      const clause = JSON.stringify(buildMediaFilter([{ mediaPublicId: 'public-abc', mediaId: 42 }]));

      expect(clause).toContain('42');
      expect(clause).not.toContain('public-abc');
    });

    it('expands episodes into one clause per episode', () => {
      expect(buildMediaFilter([{ mediaPublicId: 'a', mediaId: 1, episodes: [1, 2] }])).toEqual({
        bool: {
          should: [
            { bool: { must: [{ term: { mediaId: { value: 1 } } }, { term: { episode: { value: 1 } } }] } },
            { bool: { must: [{ term: { mediaId: { value: 1 } } }, { term: { episode: { value: 2 } } }] } },
          ],
        },
      });
    });

    it('adds no clause for empty lists', () => {
      expect(buildCommonFilters(base({ media: { include: [], exclude: [] } }))).toEqual({
        filter: [{ terms: { status: ['ACTIVE'] } }],
        must_not: [],
      });
    });
  });

  describe('terms filters', () => {
    it('expands contentRating to both cases', () => {
      expect(buildCommonFilters(base({ contentRating: ['SAFE'] })).filter[1]).toEqual({
        terms: { contentRating: ['SAFE', 'safe'] },
      });
    });

    it('passes category through unexpanded', () => {
      expect(buildCommonFilters(base({ category: ['ANIME', 'JDRAMA'] })).filter[1]).toEqual({
        terms: { category: ['ANIME', 'JDRAMA'] },
      });
    });

    it('adds no clause for empty lists', () => {
      expect(buildCommonFilters(base({ contentRating: [], category: [] })).filter).toHaveLength(1);
    });
  });
});

describe('expandContentRatingTerms', () => {
  it('emits each rating in both cases, deduplicated', () => {
    expect(expandContentRatingTerms(['SAFE', 'safe'])).toEqual(['SAFE', 'safe']);
    expect(expandContentRatingTerms(['SAFE', 'MILD'])).toEqual(['SAFE', 'safe', 'MILD', 'mild']);
  });
});
