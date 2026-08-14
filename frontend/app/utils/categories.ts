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

/** URL slugs in the order the category tabs render them. */
export const CATEGORY_SLUGS: readonly string[] = Object.keys(CATEGORY_API_MAPPING);

/** Every category the corpus has, in tab order. */
export const ALL_CATEGORIES: readonly Category[] = Object.values(CATEGORY_API_MAPPING);

export const CATEGORY_SLUG_BY_API: Record<Category, string> = Object.fromEntries(
  Object.entries(CATEGORY_API_MAPPING).map(([slug, category]) => [category, slug]),
) as Record<Category, string>;

export const isCategory = (value: unknown): value is Category => ALL_CATEGORIES.includes(value as Category);

/**
 * The reader's default category as a URL slug, ready to stand in for a missing
 * `?category=`.
 *
 * Anything that is not a category -- unset, the stored `ALL`, a value from a
 * category that no longer exists -- means the whole corpus. So does a category
 * the reader has since hidden wholesale: opening on a tab whose results were
 * deliberately dropped would show them an empty search they never asked for.
 */
export const resolveDefaultCategorySlug = (stored: unknown, hiddenCategories: readonly Category[] = []): string => {
  if (!isCategory(stored) || hiddenCategories.includes(stored)) return 'all';
  return CATEGORY_SLUG_BY_API[stored];
};

/** Tab labels, shared by the search tabs and every settings screen that names a category. */
export const CATEGORY_LABEL_KEYS: Record<Category, string> = {
  ANIME: 'searchContainer.categoryAnime',
  JDRAMA: 'searchContainer.categoryLiveaction',
  YOUTUBE: 'searchContainer.categoryYoutube',
};

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
