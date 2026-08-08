/**
 * Where the word card goes, decided from geometry alone.
 *
 * Nothing here measures the card, and that is the whole design. The tooltip used
 * to be placed, given a tick to render, measured, and then moved based on the
 * height it turned out to have -- but at that moment the card is still the
 * one-line "Looking up…", so it always fitted above and was put there. The
 * lookup then answered, the card became six times taller, the same code ran
 * again, and now it did not fit: so the card the reader was already reading
 * jumped to the other side of the word. The flip was not a layout bug. It was
 * the same decision taken twice against two different cards.
 *
 * So the inputs are the anchor and the viewport, and nothing else. The card has
 * a fixed width and a capped height (both in the stylesheet, mirrored in `BOX`
 * below), which is enough to know how much room a side needs before a single
 * sense has loaded -- and means the answer cannot change when one does. What the
 * content still decides is how tall the card ends up WITHIN that budget, which
 * is growth in one direction: it reads as the card filling in, not moving.
 *
 * Coordinates in, coordinates out, all viewport-relative. The caller adds the
 * page scroll, because the card is placed on the PAGE rather than on the screen.
 */

/** The card's own box, mirroring `width` and `max-height` on `.token-tooltip`.
 *  Duplicated from CSS on purpose: placement has to know how big the card CAN
 *  get before there is anything in it to measure. Keep the two in step. */
export const BOX = {
  width: 340,
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

  // Below by default, and that is the other half of the fix. Below, the top edge
  // is pinned to the word and the card grows downward, so the headword stays
  // exactly where it appeared. Above, the BOTTOM edge is pinned, so every line
  // that loads shoves the headword further up the screen. Above is therefore
  // only for a word too close to the bottom of the viewport to open under -- and
  // then only if there is more room up there, because on a short viewport a full
  // card fits neither side and the choice is which side is roomier.
  const below = roomBelow >= ceiling || roomBelow >= roomAbove;

  // The room actually there, never more than the design height, never less than
  // a readable one: whatever does not fit scrolls inside the body. Clamping to
  // the room rather than to the constant is what stops a 420px cap against 380px
  // of room from putting the headword 28px off the top edge, where the head is
  // pinned and cannot be scrolled back into view.
  const maxHeight = Math.max(Math.min(below ? roomBelow : roomAbove, ceiling), BOX.minHeight);

  // On the above side `top` is the card's BOTTOM edge, so this clamp keeps its
  // top on screen. A no-op unless the floor above kicked in.
  const top = below ? anchor.bottom + BOX.gap : Math.max(anchor.top - BOX.gap, BOX.margin + BOX.minHeight);

  return { below, left, top, maxHeight };
}
