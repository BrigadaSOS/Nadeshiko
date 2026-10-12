/**
 * Choose placement from anchor, viewport and the card's CSS size budget, not loading-content measurements
 * that would flip it after lookup. Coordinates are viewport-relative; callers add page scroll.
 */

/** The card's own box, mirroring `width` and `max-height` on `.token-tooltip`.
 *  Duplicated from CSS on purpose: placement has to know how big the card CAN
 *  get before there is anything in it to measure. Keep the two in step. */
export const BOX = {
  width: 480,
  /** Total horizontal room the card gives up on a screen narrower than it. */
  gutter: 24,
  ceiling: 420,
  /** The ceiling as a share of the viewport, whichever is smaller. */
  ceilingRatio: 0.52,
  /** Below this the card is not worth showing at all, so it stops shrinking and
   *  scrolls instead. A viewport too short even for that is one where clamping
   *  the top edge is what keeps the headword readable. */
  minHeight: 180,
  /** Between the token and the nearest edge of the card. */
  gap: 8,
  /** From the viewport edges. */
  margin: 8,
} as const;

/** The token the card belongs to, in viewport coordinates. */
export interface CardAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface CardViewport {
  width: number;
  height: number;
}

export interface CardPlacement {
  /** Under the token rather than over it. Also the transform the card wears:
   *  below pins its TOP edge to `top`, above pins its bottom edge there. */
  below: boolean;
  /** The card's horizontal centre. */
  left: number;
  top: number;
  /** What the card may grow to before its body starts scrolling. */
  maxHeight: number;
}

export function placeCard(anchor: CardAnchor, viewport: CardViewport): CardPlacement {
  // Centred on the word, then pulled back inside the viewport by however much it
  // overhangs. Exact rather than approximate because the width is fixed: there
  // is no wider version of this card coming that would need clamping again.
  const halfWidth = Math.min(BOX.width, viewport.width - BOX.gutter) / 2;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2, BOX.margin + halfWidth),
    viewport.width - BOX.margin - halfWidth,
  );

  const ceiling = Math.min(viewport.height * BOX.ceilingRatio, BOX.ceiling);
  const roomAbove = anchor.top - BOX.gap - BOX.margin;
  const roomBelow = viewport.height - BOX.margin - (anchor.bottom + BOX.gap);

  // Prefer below so the headword stays anchored while content grows; choose above only when below lacks the
  // budget and above has more room.
  const below = roomBelow >= ceiling || roomBelow >= roomAbove;

  // Cap by available room and design height, with a readable floor; excess content scrolls inside the card.
  const maxHeight = Math.max(Math.min(below ? roomBelow : roomAbove, ceiling), BOX.minHeight);

  // On the above side `top` is the card's BOTTOM edge, so this clamp keeps its
  // top on screen. A no-op unless the floor above kicked in.
  const top = below ? anchor.bottom + BOX.gap : Math.max(anchor.top - BOX.gap, BOX.margin + BOX.minHeight);

  return { below, left, top, maxHeight };
}
