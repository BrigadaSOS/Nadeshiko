import { describe, it, expect } from 'vitest';
import { splitNegatedTerms } from '@app/services/search/segmentDocument/queryNegation';

describe('splitNegatedTerms', () => {
  it('splits a leading-minus term off the positive query', () => {
    expect(splitNegatedTerms('"ズレ" -ズレて', false)).toEqual({
      positive: '"ズレ"',
      negatives: ['ズレて'],
    });
  });

  it('collects several exclusions', () => {
    expect(splitNegatedTerms('見る -見て -見た', false)).toEqual({
      positive: '見る',
      negatives: ['見て', '見た'],
    });
  });

  it('keeps quotes on a negated phrase so it stays a phrase', () => {
    expect(splitNegatedTerms('cat -"black dog"', false)).toEqual({
      positive: 'cat',
      negatives: ['"black dog"'],
    });
  });

  it('does not treat a hyphen inside a word as negation', () => {
    expect(splitNegatedTerms('well-known cases', false)).toEqual({
      positive: 'well-known cases',
      negatives: [],
    });
  });

  it('leaves a quoted phrase containing spaces intact', () => {
    expect(splitNegatedTerms('"one two" three', false)).toEqual({
      positive: '"one two" three',
      negatives: [],
    });
  });

  it('ignores a bare minus', () => {
    expect(splitNegatedTerms('cat - dog', false)).toEqual({
      positive: 'cat - dog',
      negatives: [],
    });
  });

  // Hoisting a `-` out of a grouped or boolean expression would change its meaning,
  // so those queries keep the old per-clause behaviour.
  it.each([
    ['(cat OR dog) -bird', 'grouping'],
    ['cat AND -dog', 'AND'],
    ['cat OR -dog', 'OR'],
    ['cat NOT dog', 'NOT'],
    ['cat && -dog', '&&'],
    ['cat || -dog', '||'],
    ['cat !dog', '!'],
  ])('leaves %s untouched (%s)', (query) => {
    expect(splitNegatedTerms(query, false)).toEqual({ positive: query, negatives: [] });
  });

  it('does not mistake a word merely containing AND/OR for an operator', () => {
    expect(splitNegatedTerms('android -organ', false)).toEqual({
      positive: 'android',
      negatives: ['organ'],
    });
  });

  it('leaves exact-match queries untouched, where operators are literal', () => {
    expect(splitNegatedTerms('ズレ -ズレて', true)).toEqual({
      positive: 'ズレ -ズレて',
      negatives: [],
    });
  });

  it('leaves an unbalanced quote for the query parser to reject', () => {
    expect(splitNegatedTerms('"ズレ -ズレて', false)).toEqual({
      positive: '"ズレ -ズレて',
      negatives: [],
    });
  });

  // Purely negative queries return nothing today; turning them into
  // "everything except X" is a product decision, not part of this fix.
  it('leaves a query that is only exclusions untouched', () => {
    expect(splitNegatedTerms('-ズレて', false)).toEqual({
      positive: '-ズレて',
      negatives: [],
    });
  });

  it('leaves a query with no exclusions untouched', () => {
    expect(splitNegatedTerms('食べる', false)).toEqual({
      positive: '食べる',
      negatives: [],
    });
  });
});
