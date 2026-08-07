import { describe, it, expect } from 'vitest';

import { discountHiddenMedia } from '../categories';
import type { ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';

const bucket = (
  category: ResolvedCategoryCount['category'],
  count: number,
  realCount = count,
): ResolvedCategoryCount => ({
  category,
  count,
  realCount,
});

const mediaStat = (
  mediaPublicId: string,
  category: ResolvedMediaStats['category'],
  matchCount: number,
): ResolvedMediaStats =>
  ({
    mediaPublicId,
    category,
    matchCount,
    episodeHits: [],
    nameRomaji: '',
    nameEn: '',
    nameJa: '',
    airingFormat: 'TV',
    slug: '',
  }) as unknown as ResolvedMediaStats;

describe('discountHiddenMedia', () => {
  it('keeps every category bucket when the payload carries a hidden media for only one of them', () => {
    // The regression: the media aggregation is scoped to `?category=youtube`, so
    // deriving the buckets from it left YOUTUBE as the only tab and made the
    // "All" total collapse onto it.
    const categories = [bucket('ANIME', 120), bucket('JDRAMA', 30), bucket('YOUTUBE', 50)];
    const hidden = [mediaStat('hidden-yt', 'YOUTUBE', 20)];

    const result = discountHiddenMedia(categories, hidden);

    expect(result).toEqual([
      bucket('ANIME', 120),
      bucket('JDRAMA', 30),
      { category: 'YOUTUBE', count: 30, realCount: 50 },
    ]);
  });

  it('sums several hidden media within the same category', () => {
    const result = discountHiddenMedia(
      [bucket('ANIME', 100)],
      [mediaStat('a', 'ANIME', 15), mediaStat('b', 'ANIME', 25)],
    );

    expect(result).toEqual([{ category: 'ANIME', count: 60, realCount: 100 }]);
  });

  it('leaves the buckets untouched when the payload carries no hidden media', () => {
    const categories = [bucket('ANIME', 10), bucket('YOUTUBE', 4)];

    expect(discountHiddenMedia(categories, [])).toEqual(categories);
  });

  it('drops a bucket the hidden media fully accounts for, and never goes negative', () => {
    const result = discountHiddenMedia([bucket('ANIME', 10), bucket('YOUTUBE', 4)], [mediaStat('a', 'YOUTUBE', 9)]);

    expect(result).toEqual([bucket('ANIME', 10)]);
  });

  it('preserves realCount, which is the count with the exclusion lifted', () => {
    const result = discountHiddenMedia([bucket('ANIME', 80, 200)], [mediaStat('a', 'ANIME', 30)]);

    expect(result[0]?.realCount).toBe(200);
  });
});
