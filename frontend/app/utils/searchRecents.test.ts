import { describe, expect, it } from 'vitest';
import {
  applyDismissals,
  clampTimestamp,
  dedupeRecents,
  narrowRecents,
  normalizeQuery,
  queryKey,
  recentKey,
  RECENTS_LIMIT,
  type RecentSearch,
  type RecentSearchMedia,
} from './searchRecents';

const at = (iso: string, query: string, ids: number[] = [], media?: RecentSearchMedia): RecentSearch => ({
  query,
  searchedAt: iso,
  ids,
  ...(media ? { media } : {}),
});

const BOCCHI: RecentSearchMedia = { publicId: 'bocchi', name: 'BOCCHI THE ROCK!' };

const NOW = new Date('2026-08-14T12:00:00.000Z');

describe('normalizeQuery / queryKey / recentKey', () => {
  it('collapses the whitespace a paste brings with it', () => {
    expect(normalizeQuery('  食べる \n ました ')).toBe('食べる ました');
  });

  it('folds case for the key but not for the text', () => {
    expect(queryKey('Ohayou')).toBe(queryKey('ohayou'));
    expect(normalizeQuery('Ohayou')).toBe('Ohayou');
  });

  it('tells a search inside a title apart from the same search everywhere', () => {
    expect(recentKey({ query: '食べる' })).not.toBe(recentKey({ query: '食べる', media: BOCCHI }));
  });

  it('keys on the title, not on its name -- a renamed show is the same scope', () => {
    expect(recentKey({ query: '食べる', media: BOCCHI })).toBe(
      recentKey({ query: '食べる', media: { publicId: 'bocchi', name: 'ぼっち・ざ・ろっく!' } }),
    );
  });

  it('cannot be confused by a query that contains the separator-adjacent text', () => {
    // Joined with NUL for this reason: any printable separator lets `食べ` in a
    // title called `る` collide with an unscoped `食べる`.
    expect(recentKey({ query: '食べ', media: { publicId: 'る' } })).not.toBe(recentKey({ query: '食べる' }));
  });
});

describe('clampTimestamp', () => {
  it('refuses a stamp from the future', () => {
    // A clock-skewed device would otherwise pin its row to the top of the list
    // for good, since the ordering is the timestamp.
    expect(clampTimestamp('2030-01-01T00:00:00.000Z', NOW)).toBe(NOW.toISOString());
  });

  it('treats an unreadable stamp as now rather than dropping the entry', () => {
    expect(clampTimestamp('yesterday', NOW)).toBe(NOW.toISOString());
    expect(clampTimestamp(undefined, NOW)).toBe(NOW.toISOString());
  });

  it('normalizes a valid stamp to UTC ISO', () => {
    expect(clampTimestamp('2026-08-14T09:00:00+02:00', NOW)).toBe('2026-08-14T07:00:00.000Z');
  });
});

describe('dedupeRecents', () => {
  it('files ninety mornings of the same word as one entry', () => {
    // The API returns one row per search event; without this the menu would be
    // eight rows of 食べる.
    const result = dedupeRecents(
      [at('2026-08-14T08:00:00.000Z', '食べる', [3]), at('2026-08-13T08:00:00.000Z', '食べる', [2])],
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.searchedAt).toBe('2026-08-14T08:00:00.000Z');
  });

  it('keeps every row id behind an entry, so forgetting it deletes them all', () => {
    const result = dedupeRecents(
      [at('2026-08-13T08:00:00.000Z', '食べる', [2]), at('2026-08-14T08:00:00.000Z', '食べる', [3])],
      NOW,
    );

    expect(result[0]?.ids).toEqual([2, 3]);
  });

  it('merges the device list and the account list in one pass', () => {
    const local = [at('2026-08-14T10:00:00.000Z', '猫')];
    const account = [at('2026-08-14T09:00:00.000Z', '猫', [7]), at('2026-08-14T08:00:00.000Z', '犬', [6])];

    const result = dedupeRecents([...local, ...account], NOW);

    expect(result.map((entry) => entry.query)).toEqual(['猫', '犬']);
    // The device knew about the search first; the account knew which row it is.
    expect(result[0]?.ids).toEqual([7]);
  });

  it('takes the newest spelling of a case-folded duplicate', () => {
    const result = dedupeRecents(
      [at('2026-08-14T08:00:00.000Z', 'Ohayou'), at('2026-08-14T09:00:00.000Z', 'ohayou')],
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.query).toBe('ohayou');
  });

  it('files the same query inside a title as its own entry', () => {
    const result = dedupeRecents(
      [at('2026-08-14T10:00:00.000Z', '食べる'), at('2026-08-14T09:00:00.000Z', '食べる', [4], BOCCHI)],
      NOW,
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.media).toBeUndefined();
    expect(result[1]?.media).toEqual(BOCCHI);
  });

  it('keeps a title name that only one side knows', () => {
    // A scoped search with no results has nothing to name the title from, and
    // must not blank the label the other side already recorded.
    const result = dedupeRecents(
      [
        at('2026-08-14T10:00:00.000Z', '食べる', [], { publicId: 'bocchi' }),
        at('2026-08-14T09:00:00.000Z', '食べる', [4], BOCCHI),
      ],
      NOW,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.media?.name).toBe('BOCCHI THE ROCK!');
  });

  it('drops blank entries instead of filing them', () => {
    expect(dedupeRecents([at('2026-08-14T08:00:00.000Z', '   ')], NOW)).toEqual([]);
  });

  it('orders newest first and caps the list', () => {
    const many = Array.from({ length: RECENTS_LIMIT + 10 }, (_, i) =>
      at(new Date(NOW.getTime() - i * 60_000).toISOString(), `word${i}`),
    );

    const result = dedupeRecents(many, NOW);

    expect(result).toHaveLength(RECENTS_LIMIT);
    expect(result[0]?.query).toBe('word0');
    expect(result.at(-1)?.query).toBe(`word${RECENTS_LIMIT - 1}`);
  });
});

describe('applyDismissals', () => {
  it('keeps a forgotten query gone when an older account row survives the delete', () => {
    // The menu only holds the ids from the last fetch window, so a delete can
    // leave an older row for the same query behind. Without the tombstone it
    // climbs back into the list on the next load.
    const account = [at('2026-08-01T08:00:00.000Z', '食べる', [1])];
    const dismissed = { [recentKey({ query: '食べる' })]: '2026-08-14T08:00:00.000Z' };

    expect(applyDismissals(account, dismissed)).toEqual([]);
  });

  it('lets the query back in once it is searched again', () => {
    const account = [at('2026-08-14T09:00:00.000Z', '食べる', [9])];
    const dismissed = { [recentKey({ query: '食べる' })]: '2026-08-14T08:00:00.000Z' };

    expect(applyDismissals(account, dismissed)).toHaveLength(1);
  });

  it('leaves everything alone when nothing has been forgotten', () => {
    const account = [at('2026-08-14T09:00:00.000Z', '犬')];
    expect(applyDismissals(account, {})).toBe(account);
  });

  it('forgetting a scoped search leaves the general one alone', () => {
    const account = [at('2026-08-01T08:00:00.000Z', '食べる'), at('2026-08-01T08:00:00.000Z', '食べる', [1], BOCCHI)];
    const dismissed = { [recentKey({ query: '食べる', media: BOCCHI })]: '2026-08-14T08:00:00.000Z' };

    const kept = applyDismissals(account, dismissed);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.media).toBeUndefined();
  });
});

describe('narrowRecents', () => {
  const entries = [
    at('2026-08-14T10:00:00.000Z', '食べる'),
    at('2026-08-14T09:00:00.000Z', '食べ物'),
    at('2026-08-14T08:00:00.000Z', '飲む'),
  ];

  it("offers back this morning's 食べる when the reader types 食", () => {
    expect(narrowRecents(entries, '食').map((entry) => entry.query)).toEqual(['食べる', '食べ物']);
  });

  it('matches anywhere in the query, not just its start', () => {
    expect(narrowRecents(entries, 'べる').map((entry) => entry.query)).toEqual(['食べる']);
  });

  it('shows the whole list for an empty box', () => {
    expect(narrowRecents(entries, '  ')).toHaveLength(3);
  });

  it('narrows case-insensitively', () => {
    const romaji = [at('2026-08-14T10:00:00.000Z', 'Ohayou')];
    expect(narrowRecents(romaji, 'ohay')).toHaveLength(1);
  });

  it('keeps both scopes of a matching query', () => {
    // Narrowing matches the query alone: the title tells the two rows apart, it
    // does not hide one of them from a reader typing what they searched for.
    const scoped = [...entries, at('2026-08-14T07:00:00.000Z', '食べる', [1], BOCCHI)];
    expect(narrowRecents(scoped, '食べる')).toHaveLength(2);
  });

  it('caps the rows the menu is handed', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      at(`2026-08-14T10:00:${String(i).padStart(2, '0')}.000Z`, `w${i}`),
    );
    expect(narrowRecents(many, '', 8)).toHaveLength(8);
  });
});
