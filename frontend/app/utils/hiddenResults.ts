import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';

/**
 * Derive hidden-result counts and breakdowns from server buckets and reader exclusions, independently of
 * container UI.
 */

/** The scope the count is taken over: what the result list is currently drawing from. */
export type HiddenResultsScope = {
  categories: readonly ResolvedCategoryCount[];
  /** Stats media rows, which carry the per-title hit counts. */
  media: readonly ResolvedMediaStats[];
  hiddenMediaIds: readonly string[];
  hiddenCategories: readonly Category[];
  /** The category tab in view, or null for "All". */
  selectedCategory: Category | null;
  /** True when a single title was picked with `?media=`. */
  hasMediaFilter: boolean;
};

/** One row of the breakdown popover: a hidden title, or a whole hidden category. */
export type HiddenBreakdownRow = { name: string; count: number };

const hiddenHitsByCategory = (scope: HiddenResultsScope): Map<Category, number> => {
  const hidden = new Set(scope.hiddenMediaIds);
  const totals = new Map<Category, number>();

  for (const item of scope.media) {
    if (!hidden.has(item.mediaPublicId)) continue;
    totals.set(item.category, (totals.get(item.category) ?? 0) + item.matchCount);
  }

  return totals;
};

/**
 * A bucket is out of scope when a category tab is open and this is not it: the
 * list only draws from the open one, so nothing else is being kept out of it.
 * The open tab itself is never treated as hidden -- an explicit `?category=`
 * beats the hidden list, the same way an explicit `?media=` does.
 */
const inScope = (entry: ResolvedCategoryCount, scope: HiddenResultsScope): boolean =>
  scope.selectedCategory === null || entry.category === scope.selectedCategory;

const isHiddenWholesale = (entry: ResolvedCategoryCount, scope: HiddenResultsScope): boolean =>
  scope.hiddenCategories.includes(entry.category) && entry.category !== scope.selectedCategory;

/**
 * Explicit title filters bypass hidden lists. Otherwise count wholesale hidden buckets, or server count gaps
 * plus client-side hidden-title hits when preferences were not applied upstream. Fully excluded buckets may
 * be absent, yielding zero; callers must separately check whether hiding may explain an empty result set.
 */
export const countHiddenResults = (scope: HiddenResultsScope): number => {
  if (scope.hasMediaFilter) return 0;

  const hiddenHits = hiddenHitsByCategory(scope);

  return scope.categories.reduce((total, entry) => {
    if (!inScope(entry, scope)) return total;
    if (isHiddenWholesale(entry, scope)) return total + entry.realCount;
    return total + Math.max(0, entry.realCount - entry.count) + (hiddenHits.get(entry.category) ?? 0);
  }, 0);
};

/**
 * The titles behind that count, largest first, for the popover.
 *
 * Built from a stats payload fetched with the filters lifted, so the hidden
 * titles are present to name. A hidden category is one row for the whole bucket
 * instead of a row per title inside it, and those titles are skipped so the rows
 * still sum to `countHiddenResults`.
 */
export const buildHiddenBreakdown = (
  scope: HiddenResultsScope,
  label: { category: (category: Category) => string; media: (media: ResolvedMediaStats) => string },
): HiddenBreakdownRow[] => {
  if (scope.hasMediaFilter) return [];

  const hidden = new Set(scope.hiddenMediaIds);

  const categoryRows = scope.categories
    .filter((entry) => inScope(entry, scope) && isHiddenWholesale(entry, scope))
    .map((entry) => ({ name: label.category(entry.category), count: entry.realCount }));

  const mediaRows = scope.media
    .filter(
      (item) =>
        hidden.has(item.mediaPublicId) &&
        item.matchCount > 0 &&
        !scope.hiddenCategories.includes(item.category) &&
        (scope.selectedCategory === null || item.category === scope.selectedCategory),
    )
    .map((item) => ({ name: label.media(item), count: item.matchCount }));

  return [...categoryRows, ...mediaRows].sort((a, b) => b.count - a.count);
};
