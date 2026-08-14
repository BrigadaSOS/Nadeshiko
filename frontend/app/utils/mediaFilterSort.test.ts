import { describe, expect, it } from 'vitest';
import { compareMediaRows, mediaFilterTier, type SortableMediaRow } from './mediaFilterSort';

const row = (mediaPublicId: string | null, displayNameLower: string): SortableMediaRow => ({
  mediaPublicId,
  displayNameLower,
});

const sort = (rows: SortableMediaRow[], favorites: string[] = [], inferred: string[] = []): string[] => {
  const favoriteIds = new Set(favorites);
  const inferredRank = new Map(inferred.map((id, index) => [id, index]));
  return [...rows]
    .sort((a, b) => compareMediaRows(a, b, favoriteIds, inferredRank))
    .map((item) => item.mediaPublicId ?? 'all');
};

describe('mediaFilterTier', () => {
  it('puts a starred title ahead of an inferred one', () => {
    const favoriteIds = new Set(['starred']);
    const inferredRank = new Map([['inferred', 0]]);

    expect(mediaFilterTier('starred', favoriteIds, inferredRank)).toBe(0);
    expect(mediaFilterTier('inferred', favoriteIds, inferredRank)).toBe(1);
    expect(mediaFilterTier('other', favoriteIds, inferredRank)).toBe(2);
  });

  it('treats a title that is both starred and inferred as starred', () => {
    expect(mediaFilterTier('both', new Set(['both']), new Map([['both', 0]]))).toBe(0);
  });
});

describe('compareMediaRows', () => {
  const rows = [row('c', 'cowboy bebop'), row('a', 'akira'), row('b', 'bleach')];

  it('is a no-op with nothing starred and nothing inferred', () => {
    // What a signed-out reader gets: the plain alphabetical list the filter has
    // always had, not a degraded version of the signed-in one.
    expect(sort(rows)).toEqual(['a', 'b', 'c']);
  });

  it('floats starred titles above the rest, alphabetically among themselves', () => {
    expect(sort(rows, ['c', 'b'])).toEqual(['b', 'c', 'a']);
  });

  it('orders inferred titles by rank rather than by name', () => {
    // 'c' outranks 'a' in the server's ranking, so it sorts first despite the name.
    expect(sort(rows, [], ['c', 'a'])).toEqual(['c', 'a', 'b']);
  });

  it('keeps a star above a higher-ranked inferred title', () => {
    // The deliberate choice always wins over the inferred one -- the property
    // that makes starring worth doing.
    expect(sort(rows, ['b'], ['c', 'a'])).toEqual(['b', 'c', 'a']);
  });

  it('breaks ties on name so the order does not wobble between renders', () => {
    const tied = [row('z', 'same name'), row('y', 'same name')];
    expect(sort(tied, [], ['z', 'y'])).toEqual(['z', 'y']);
  });

  it('sorts an unranked title below every ranked one', () => {
    expect(sort([row('unranked', 'aaa'), row('ranked', 'zzz')], [], ['ranked'])).toEqual(['ranked', 'unranked']);
  });
});
