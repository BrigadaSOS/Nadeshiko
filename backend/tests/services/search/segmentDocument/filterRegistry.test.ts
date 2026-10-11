import { describe, it, expect } from 'vitest';
import { buildCommonFilters, expandContentRatingTerms } from '@app/services/search/segmentDocument/filterRegistry';

/**
 * Pins the exact Elasticsearch clauses each request filter produces.
 *
 * Literal expected clauses guard field mapping, polarity, and stable output order.
 * Search-stats cache keys are derived from request values, not this query DSL.
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

  it('emits the complete ordered clauses for combined filters', () => {
    const { filter } = buildCommonFilters(
      base({
        segmentLengthChars: { min: 1, max: 2 },
        segmentDurationMs: { min: 3, max: 4 },
        media: { include: [{ mediaPublicId: 'p', mediaId: 7 }] },
        contentRating: ['SAFE'],
        category: ['ANIME'],
      }),
    );

    expect(filter).toEqual([
      { terms: { status: ['ACTIVE'] } },
      { range: { characterCount: { gte: 1, lte: 2 } } },
      { range: { durationMs: { gte: 3, lte: 4 } } },
      { bool: { should: [{ bool: { must: [{ term: { mediaId: { value: 7 } } }] } }] } },
      { terms: { contentRating: ['SAFE', 'safe'] } },
      { terms: { category: ['ANIME'] } },
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
  });

  describe('media filters', () => {
    it('puts include in filter and exclude in must_not', () => {
      const result = buildCommonFilters(
        base({
          media: {
            include: [{ mediaPublicId: 'public-abc', mediaId: 42 }],
            exclude: [{ mediaPublicId: 'b', mediaId: 2 }],
          },
        }),
      );

      expect(result.filter[1]).toEqual({
        bool: { should: [{ bool: { must: [{ term: { mediaId: { value: 42 } } }] } }] },
      });
      expect(result.must_not).toEqual([
        { bool: { should: [{ bool: { must: [{ term: { mediaId: { value: 2 } } }] } }] } },
      ]);
    });

    it('expands episodes into one clause per episode', () => {
      expect(
        buildCommonFilters(base({ media: { include: [{ mediaPublicId: 'a', mediaId: 1, episodes: [1, 2] }] } }))
          .filter[1],
      ).toEqual({
        bool: {
          should: [
            { bool: { must: [{ term: { mediaId: { value: 1 } } }, { term: { episode: { value: 1 } } }] } },
            { bool: { must: [{ term: { mediaId: { value: 1 } } }, { term: { episode: { value: 2 } } }] } },
          ],
        },
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
  });
  it.each([
    ['empty range', { segmentLengthChars: {} }],
    ['empty media lists', { media: { include: [], exclude: [] } }],
    ['empty term lists', { contentRating: [], category: [] }],
  ])('preserves status scoping with %s', (_label, filters) => {
    expect(buildCommonFilters(base(filters))).toEqual({ filter: [{ terms: { status: ['ACTIVE'] } }], must_not: [] });
  });
});

describe('expandContentRatingTerms', () => {
  it('emits each rating in both cases, deduplicated', () => {
    expect(expandContentRatingTerms(['SAFE', 'safe'])).toEqual(['SAFE', 'safe']);
    expect(expandContentRatingTerms(['SAFE', 'MILD'])).toEqual(['SAFE', 'safe', 'MILD', 'mild']);
  });
});
