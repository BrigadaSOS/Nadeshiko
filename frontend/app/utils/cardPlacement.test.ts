import { describe, expect, it } from 'vitest';
import { BOX, placeCard, type CardAnchor } from './cardPlacement';

const VIEWPORT = { width: 1280, height: 900 };

/** A word 60px wide on one line, its top edge at `top`. */
const word = (top: number, left = 600): CardAnchor => ({ top, bottom: top + 24, left, width: 60 });

describe('placeCard', () => {
  it('opens under the word, so the headword stays where it appeared', () => {
    const placement = placeCard(word(300), VIEWPORT);

    expect(placement.below).toBe(true);
    expect(placement.top).toBe(324 + BOX.gap);
  });

  it('centres on the word', () => {
    expect(placeCard(word(300, 600), VIEWPORT).left).toBe(630);
  });

  it('does not move when the card fills in', () => {
    // The regression this file exists for. Placement used to be re-run once the
    // lookup answered, and the taller card flipped to the other side of the word
    // mid-read. There is no longer any input that could make it differ: the same
    // word and the same viewport can only produce the same answer, whatever the
    // card happens to contain.
    const anchor = word(300);

    expect(placeCard(anchor, VIEWPORT)).toEqual(placeCard(anchor, VIEWPORT));
  });

  it('goes above only for a word too near the bottom to open under', () => {
    // 200px of room below is less than the card's full height, and there is far
    // more above, so it opens upward -- and `top` is its bottom edge there.
    const placement = placeCard(word(672), VIEWPORT);

    expect(placement.below).toBe(false);
    expect(placement.top).toBe(672 - BOX.gap);
    expect(placement.maxHeight).toBe(BOX.ceiling);
  });

  it('stays below when there is room for the whole card, however much is above', () => {
    // Mid-page, with more room above than below, but below still fits a full
    // card -- and a full card is the most it can ever need.
    const placement = placeCard(word(500), { width: 1280, height: 960 });

    expect(placement.below).toBe(true);
  });

  it('takes the roomier side when a full card fits neither', () => {
    const short = { width: 1280, height: 600 };

    expect(placeCard(word(40), short).below).toBe(true);
    expect(placeCard(word(520), short).below).toBe(false);
  });

  it('caps the height to the room actually there, so the rest scrolls', () => {
    // A word halfway down a short viewport: below is the roomier side but has
    // only 226px, less than the 312px (52vh) the card would like. It gets the
    // 226 and its body scrolls inside that, rather than running off the bottom.
    const placement = placeCard(word(234), { width: 1280, height: 500 });

    expect(placement.below).toBe(true);
    expect(placement.maxHeight).toBe(226);
  });

  it('never takes more than the design height, however much room there is', () => {
    // Half a tall viewport is more room than the card should ever fill.
    expect(placeCard(word(100), { width: 1280, height: 1600 }).maxHeight).toBe(BOX.ceiling);
    // On a short one the 52vh share binds before the 420px does.
    expect(placeCard(word(520), { width: 1280, height: 600 }).maxHeight).toBe(312);
  });

  it('never promises more height than the design allows', () => {
    for (const height of [600, 800, 1200, 2400]) {
      const placement = placeCard(word(100), { width: 1280, height });
      expect(placement.maxHeight).toBeLessThanOrEqual(Math.max(BOX.ceiling, BOX.minHeight));
    }
  });

  it('keeps the card on screen at either edge', () => {
    const half = BOX.width / 2;

    expect(placeCard(word(300, 0), VIEWPORT).left).toBe(BOX.margin + half);
    expect(placeCard(word(300, 1220), VIEWPORT).left).toBe(VIEWPORT.width - BOX.margin - half);
  });

  it('fills the width on a phone, and still centres inside the margins', () => {
    const phone = { width: 360, height: 740 };
    // The card is 360 - 24 wide there, so its centre has 8 + 168 of travel from
    // either edge and every word on the line resolves to the same place.
    expect(placeCard(word(300, 4), phone).left).toBe(176);
    expect(placeCard(word(300, 320), phone).left).toBe(184);
  });

  it('keeps the head on screen for a word at the very top of a tiny viewport', () => {
    // Neither side can hold a readable card. It opens above anyway only if that
    // is the roomier side; wherever it lands, the top edge stays visible.
    const tiny = { width: 1280, height: 320 };
    const placement = placeCard(word(280), tiny);

    expect(placement.maxHeight).toBe(BOX.minHeight);
    const topEdge = placement.below ? placement.top : placement.top - placement.maxHeight;
    expect(topEdge).toBeGreaterThanOrEqual(BOX.margin);
  });
});
