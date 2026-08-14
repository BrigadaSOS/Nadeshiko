/**
 * The order titles appear in inside the search media filter.
 *
 * The filter lists every title the current query matched, and a broad query
 * matches a lot of them, so the shows a reader actually knows are buried in an
 * alphabetical wall. This lifts those to the top -- it changes the ORDER of that
 * list and never its contents: a starred title the query did not match is not
 * absent by mistake, it simply has no results to offer.
 *
 * Three tiers, in this order:
 *
 *   0. starred by the reader, deliberately
 *   1. inferred from what the reader studies (see `useFamiliarMedia`)
 *   2. everything else
 *
 * Tier beats score, always, so a star is never overruled by the inference --
 * which is what makes the star worth having: it is the predictable half.
 *
 * Kept pure and free of Vue so the ordering is testable on its own, including
 * the property that matters most: with no favorites and nothing inferred, this
 * reproduces the plain alphabetical order the filter had before the feature
 * existed. That is what a signed-out reader gets, and it must be a no-op rather
 * than a degraded version of the signed-in list.
 */
export type SortableMediaRow = {
  mediaPublicId: string | null;
  displayNameLower: string;
};

export function mediaFilterTier(
  mediaPublicId: string | null,
  favoriteIds: ReadonlySet<string>,
  inferredRank: ReadonlyMap<string, number>,
): 0 | 1 | 2 {
  if (!mediaPublicId) return 2;
  if (favoriteIds.has(mediaPublicId)) return 0;
  if (inferredRank.has(mediaPublicId)) return 1;
  return 2;
}

export function compareMediaRows<T extends SortableMediaRow>(
  a: T,
  b: T,
  favoriteIds: ReadonlySet<string>,
  inferredRank: ReadonlyMap<string, number>,
): number {
  const tierA = mediaFilterTier(a.mediaPublicId, favoriteIds, inferredRank);
  const tierB = mediaFilterTier(b.mediaPublicId, favoriteIds, inferredRank);
  if (tierA !== tierB) return tierA - tierB;

  // Inferred titles keep the server's ranking; the reader never chose this order,
  // so the strongest signal should be nearest the top.
  if (tierA === 1) {
    const rankA = inferredRank.get(a.mediaPublicId as string) ?? Number.MAX_SAFE_INTEGER;
    const rankB = inferredRank.get(b.mediaPublicId as string) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
  }

  // Starred titles sort alphabetically rather than by when they were starred:
  // this is a list to find a title in, and "the order I happened to click stars
  // in months ago" reads as no order at all.
  if (a.displayNameLower < b.displayNameLower) return -1;
  if (a.displayNameLower > b.displayNameLower) return 1;
  return 0;
}
