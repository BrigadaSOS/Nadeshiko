import { describe, expect, it } from 'vitest';
import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';
import { buildHiddenBreakdown, countHiddenResults, type HiddenResultsScope } from './hiddenResults';

const bucket = (category: Category, count: number, realCount = count): ResolvedCategoryCount => ({
  category,
  count,
  realCount,
});

const title = (mediaPublicId: string, category: Category, matchCount: number): ResolvedMediaStats =>
  ({ mediaPublicId, category, matchCount, nameEn: mediaPublicId }) as unknown as ResolvedMediaStats;

const scope = (over: Partial<HiddenResultsScope> = {}): HiddenResultsScope => ({
  categories: [],
  media: [],
  hiddenMediaIds: [],
  hiddenCategories: [],
  selectedCategory: null,
  hasMediaFilter: false,
  ...over,
});

const label = {
  category: (category: Category) => `category:${category}`,
  media: (media: ResolvedMediaStats) => media.nameEn ?? '',
};

describe('countHiddenResults', () => {
  it('is zero when the reader hides nothing', () => {
    expect(countHiddenResults(scope({ categories: [bucket('ANIME', 1317)] }))).toBe(0);
  });

  it('counts the gap the server leaves once it excludes hidden titles', () => {
    // What `/v1/search/stats` returns with one title excluded: the bucket keeps
    // the corpus total in `realCount` and drops the hidden hits from `count`.
    const result = countHiddenResults(
      scope({
        categories: [bucket('ANIME', 864, 1317), bucket('JDRAMA', 180)],
        hiddenMediaIds: ['bocchi'],
      }),
    );

    expect(result).toBe(453);
  });

  it('counts hidden titles a payload still carries, where the two server counts agree', () => {
    // The SSR-before-preferences case that `discountHiddenMedia` corrects: the
    // server did not know to exclude anything, so the gap has to come from the
    // media rows instead. Never both -- that would double-count.
    const result = countHiddenResults(
      scope({
        categories: [bucket('ANIME', 1317)],
        media: [title('bocchi', 'ANIME', 333), title('hinamatsuri', 'ANIME', 170)],
        hiddenMediaIds: ['bocchi', 'hinamatsuri'],
      }),
    );

    expect(result).toBe(503);
  });

  it('counts a wholly hidden category as its whole bucket', () => {
    const result = countHiddenResults(
      scope({
        categories: [bucket('ANIME', 1317), bucket('JDRAMA', 180)],
        hiddenCategories: ['JDRAMA'],
      }),
    );

    expect(result).toBe(180);
  });

  it('ignores buckets the open tab is not drawing from', () => {
    const result = countHiddenResults(
      scope({
        categories: [bucket('ANIME', 864, 1317), bucket('JDRAMA', 100, 180)],
        selectedCategory: 'JDRAMA',
      }),
    );

    expect(result).toBe(80);
  });

  it('does not treat the open tab as hidden, since an explicit category beats the list', () => {
    const result = countHiddenResults(
      scope({
        categories: [bucket('JDRAMA', 180)],
        hiddenCategories: ['JDRAMA'],
        selectedCategory: 'JDRAMA',
      }),
    );

    expect(result).toBe(0);
  });

  it('is zero for a title picked explicitly, which beats the hidden list', () => {
    // The tab's own `count`/`totalCount` differ here too -- hits in this title
    // against hits everywhere -- which is why the notice cannot be driven off it.
    const result = countHiddenResults(
      scope({
        categories: [bucket('ANIME', 2, 1317)],
        hiddenMediaIds: ['bocchi'],
        hasMediaFilter: true,
      }),
    );

    expect(result).toBe(0);
  });

  it('is zero when every hit was hidden, because the server drops the emptied bucket', () => {
    // Not "nothing is hidden": there is no payload left to count. The caller
    // tells the two apart by the result list being empty.
    expect(countHiddenResults(scope({ categories: [], hiddenMediaIds: ['godzilla'] }))).toBe(0);
  });
});

describe('buildHiddenBreakdown', () => {
  it('names the hidden titles, largest first, summing to the count', () => {
    const filled = scope({
      categories: [bucket('ANIME', 1317)],
      media: [title('hinamatsuri', 'ANIME', 170), title('bocchi', 'ANIME', 333), title('suzume', 'ANIME', 12)],
      hiddenMediaIds: ['bocchi', 'hinamatsuri'],
    });

    const rows = buildHiddenBreakdown(filled, label);

    expect(rows).toEqual([
      { name: 'bocchi', count: 333 },
      { name: 'hinamatsuri', count: 170 },
    ]);
    expect(rows.reduce((total, row) => total + row.count, 0)).toBe(countHiddenResults(filled));
  });

  it('gives a wholly hidden category one row rather than a row per title inside it', () => {
    const rows = buildHiddenBreakdown(
      scope({
        categories: [bucket('ANIME', 1317), bucket('JDRAMA', 180)],
        media: [title('drama-a', 'JDRAMA', 120), title('drama-b', 'JDRAMA', 60)],
        hiddenMediaIds: ['drama-a'],
        hiddenCategories: ['JDRAMA'],
      }),
      label,
    );

    expect(rows).toEqual([{ name: 'category:JDRAMA', count: 180 }]);
  });

  it('leaves out titles the open tab is not drawing from', () => {
    const rows = buildHiddenBreakdown(
      scope({
        categories: [bucket('ANIME', 1317), bucket('JDRAMA', 180)],
        media: [title('bocchi', 'ANIME', 333), title('godzilla', 'JDRAMA', 2)],
        hiddenMediaIds: ['bocchi', 'godzilla'],
        selectedCategory: 'JDRAMA',
      }),
      label,
    );

    expect(rows).toEqual([{ name: 'godzilla', count: 2 }]);
  });

  it('is empty when nothing the reader hides matched the search', () => {
    expect(buildHiddenBreakdown(scope({ hiddenMediaIds: ['bocchi'] }), label)).toEqual([]);
  });
});
