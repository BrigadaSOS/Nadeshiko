import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';

/**
 * Maps URL-friendly category slugs to API category values.
 */
export const CATEGORY_API_MAPPING: Record<string, Category> = {
  anime: 'ANIME',
  liveaction: 'JDRAMA',
  youtube: 'YOUTUBE',
} as const;

/**
 * Discounts hidden media the stats payload still carries from the server's
 * category buckets.
 *
 * The payload normally arrives with the user's hidden media already excluded
 * server-side. It can still carry them when it predates the preferences being
 * known -- an SSR render for a not-yet-hydrated user, or a `useAsyncData` entry
 * cached under a key that ignores the hidden list -- so the correction is driven
 * by the hidden media actually present in the payload, which makes it a no-op on
 * an already-filtered one rather than a second subtraction.
 *
 * The counts are subtracted from the server's buckets instead of being rebuilt
 * from the media list. The media aggregation is scoped to the selected
 * `?category=` while the category aggregation deliberately is not (see
 * `SegmentDocument.querySearchStatisticsWithMustQueries`), so rebuilding from it
 * dropped every other category's bucket -- hiding the other tabs and collapsing
 * the "All" total onto the selected category.
 */
export const discountHiddenMedia = (
  categories: ResolvedCategoryCount[],
  hiddenMediaInPayload: ResolvedMediaStats[],
): ResolvedCategoryCount[] => {
  const hiddenByCategory = new Map<Category, number>();
  for (const media of hiddenMediaInPayload) {
    hiddenByCategory.set(media.category, (hiddenByCategory.get(media.category) ?? 0) + media.matchCount);
  }

  return categories
    .map((entry) => ({ ...entry, count: Math.max(0, entry.count - (hiddenByCategory.get(entry.category) ?? 0)) }))
    .filter((entry) => entry.count > 0);
};
