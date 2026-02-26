import { describe, it, expect } from 'bun:test';

describe('toEqualUnordered', () => {
  it('matches same items regardless of order', () => {
    expect([{ id: 1 }, { id: 2 }]).toEqualUnordered([{ id: 2 }, { id: 1 }]);
  });

  it('works with nested asymmetric matchers', () => {
    expect([
      { id: 1, name: 'Yor' },
      { id: 2, name: 'Loid' },
    ]).toEqualUnordered([expect.objectContaining({ id: 2 }), expect.objectContaining({ id: 1 })]);
  });

  it('fails when arrays have different lengths', () => {
    expect([{ id: 1 }, { id: 2 }, { id: 3 }]).not.toEqualUnordered([{ id: 1 }, { id: 2 }]);
  });

  it('fails when items do not match', () => {
    expect([{ id: 1 }, { id: 2 }]).not.toEqualUnordered([{ id: 1 }, { id: 3 }]);
  });

  it('fails for non-array input', () => {
    expect('not an array').not.toEqualUnordered([1, 2]);
  });
});
