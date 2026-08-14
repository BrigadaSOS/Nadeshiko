/**
 * The list behind the Manage Media card: the titles a reader has marked, from
 * the two lists that hold them.
 *
 * Pure so it can be tested: the card that uses it is a component, and this
 * project's vitest runs in `node` with no DOM, so anything worth asserting has
 * to live outside the SFC.
 */

export type MarkedMediaSource = {
  mediaPublicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

export type MarkedMedia = {
  publicId: string;
  nameEn?: string;
  nameJa?: string;
  nameRomaji?: string;
};

const timestamp = (value?: string): number => {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Favourites and hidden titles merged into one list, most recently acted on
 * first.
 *
 * A title that is both favourited and hidden appears once, ordered by whichever
 * happened later: it is one title carrying two flags, not two entries, and the
 * row it renders shows both.
 *
 * Titles with no usable timestamp sort last rather than being dropped -- a
 * missing date is a reason to place a title badly, not to hide a setting the
 * reader made.
 */
export function mergeMarkedMedia(
  favorites: Array<MarkedMediaSource & { favoritedAt?: string }>,
  hidden: Array<MarkedMediaSource & { hiddenAt?: string }>,
): MarkedMedia[] {
  const byId = new Map<string, { media: MarkedMedia; at: number }>();

  const add = (item: MarkedMediaSource, at: number) => {
    const existing = byId.get(item.mediaPublicId);
    if (existing) {
      existing.at = Math.max(existing.at, at);
      return;
    }
    byId.set(item.mediaPublicId, {
      at,
      media: {
        publicId: item.mediaPublicId,
        nameEn: item.nameEn,
        nameJa: item.nameJa,
        nameRomaji: item.nameRomaji,
      },
    });
  };

  for (const item of favorites) add(item, timestamp(item.favoritedAt));
  for (const item of hidden) add(item, timestamp(item.hiddenAt));

  return [...byId.values()].sort((a, b) => b.at - a.at).map((entry) => entry.media);
}
