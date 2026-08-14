import type { Category } from '@brigadasos/nadeshiko-sdk';
import type { ResolvedCategoryCount, ResolvedMediaStats } from '~/types/search';

/**
 * What the reader's own hidden-media and hidden-category lists are keeping out
 * of a search, for the notice above the results that offers to lift them.
 *
 * Pure, and here rather than in the container, because the derivation is the
 * part that is easy to get subtly wrong and impossible to eyeball: it reads two
 * counts the server sends per bucket and has to keep three cases apart. It is
 * the same reasoning that put `discountHiddenMedia` in `categories.ts`.
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
 * Hits this query found that the reader is not being shown.
 *
 * Counted per category bucket rather than from the tab's `count`/`totalCount`
 * pair, which also opens a gap for `?media=` and would have the notice offer to
 * unhide something when nothing is hidden. A title picked explicitly beats the
 * hidden list outright, so it keeps nothing out either -- hence the 0.
 *
 *   - a category hidden wholesale keeps out its whole bucket;
 *   - a category that was kept loses only the titles hidden inside it.
 *     `realCount` is that bucket with the exclusion lifted server-side, and the
 *     media term covers a payload that arrived before the reader's preferences
 *     were known -- the one `discountHiddenMedia` corrects client-side, where the
 *     server's two counts are equal. Only ever one of the two terms is non-zero.
 *
 * Returns 0 for a search hidden down to nothing, which is not the same as
 * nothing being hidden: the server drops a bucket once its last hit is excluded,
 * leaving no payload to count. The caller distinguishes the two by whether the
 * result set is empty -- see `SearchContainer`'s `hiddenMayExplainEmpty`.
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
