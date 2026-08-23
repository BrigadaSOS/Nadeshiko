/**
 * The list behind the Manage Media card: the titles a reader has marked, from
 * the two lists that hold them.
 *
 * Pure so it can be tested: the card that uses it is a component, and this
 * project's vitest runs in `node` with no DOM, so anything worth asserting has
 * to live outside the SFC.
 */

export type MarkedMedia = {
  publicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

/**
 * Favourites and hidden titles merged into one list.
 *
 * Takes ids and a separate name lookup because the stored preferences carry no
 * names any more -- they are resolved from `/v1/user/favorite-media` and
 * `/v1/user/excluded-media`, which read the catalogue rather than a copy of it
 * that goes stale on a rename. An id the lookup does not answer for is still
 * listed: the row falls back to `Media #{id}` and its controls still work, which
 * is what a reader needs to clear an entry whose title has left the catalogue.
 *
 * Favourites come first, in the order given (the endpoint sorts them newest
 * first), then the hidden titles in the order they were hidden. A title that is
 * both appears once, under favourites: it is one title carrying two flags, not
 * two entries, and the row it renders shows both.
 */
export function mergeMarkedMedia(
  favoriteIds: readonly string[],
  hiddenIds: readonly string[],
  names: ReadonlyMap<string, MarkedMedia>,
): MarkedMedia[] {
  const seen = new Set<string>();
  const merged: MarkedMedia[] = [];

  for (const publicId of [...favoriteIds, ...hiddenIds]) {
    if (seen.has(publicId)) continue;
    seen.add(publicId);
    merged.push(names.get(publicId) ?? { publicId });
  }

  return merged;
}
