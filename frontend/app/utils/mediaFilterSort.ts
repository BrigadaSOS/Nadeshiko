/**
 * The order titles appear in inside the search media filter.
 *
 * The filter lists every title the current query matched, and a broad query
 * matches a lot of them. The reader picks one of two orders (see
 * `useMediaFilterSort`); either way this changes the ORDER of that list and never
 * its contents: a starred title the query did not match is not absent by
 * mistake, it simply has no results to offer.
 *
 * `alphabetical` (the default) lifts the shows a reader knows out of an
 * alphabetical wall, in three tiers:
 *
 *   0. starred by the reader, deliberately
 *   1. inferred from what the reader studies (see `useFamiliarMedia`)
 *   2. everything else
 *
 * Tier beats name, always, so a star is never overruled by the inference --
 * which is what makes the star worth having: it is the predictable half.
 *
 * `matches` puts the titles with the most sentences first. A word with few
 * results is often swamped by one show, and this makes that show easy to find
 * and the single-line ones easy to scan. Stars still lead, because they are the
 * reader's own choice; the inferred tier does not exist here, since a guess
 * outranking the order the reader just asked for would contradict it.
 *
 * Kept pure and free of Vue so the ordering is testable on its own, including
 * the property that matters most: in `alphabetical` with no favorites and
 * nothing inferred, this is the plain alphabetical list a signed-out reader has
 * always had.
 */
export const MEDIA_SORT_MODES = ['alphabetical', 'matches'] as const;
export type MediaSortMode = (typeof MEDIA_SORT_MODES)[number];
export const DEFAULT_MEDIA_SORT_MODE: MediaSortMode = 'alphabetical';

export type SortableMediaRow = {
  mediaPublicId: string | null;
  displayNameLower: string;
  matchCount: number;
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

function compareNames(a: SortableMediaRow, b: SortableMediaRow): number {
  if (a.displayNameLower < b.displayNameLower) return -1;
  if (a.displayNameLower > b.displayNameLower) return 1;
  return 0;
}

export function compareMediaRows<T extends SortableMediaRow>(
  a: T,
  b: T,
  favoriteIds: ReadonlySet<string>,
  inferredRank: ReadonlyMap<string, number>,
  mode: MediaSortMode = DEFAULT_MEDIA_SORT_MODE,
): number {
  if (mode === 'matches') {
    const starredA = !!a.mediaPublicId && favoriteIds.has(a.mediaPublicId);
    const starredB = !!b.mediaPublicId && favoriteIds.has(b.mediaPublicId);
    if (starredA !== starredB) return starredA ? -1 : 1;
    if (a.matchCount !== b.matchCount) return b.matchCount - a.matchCount;
    // Name breaks ties, so the order does not wobble between renders.
    return compareNames(a, b);
  }

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
  return compareNames(a, b);
}
