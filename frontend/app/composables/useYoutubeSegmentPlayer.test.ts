import { describe, it, expect } from 'vitest';

import { isClipTimeSettled } from './useYoutubeSegmentPlayer';

/** The tick count at which the backstop gives up waiting -- `ARM_GRACE_TICKS`. */
const GRACE = 15;

describe('isClipTimeSettled', () => {
  it('trusts a playhead inside the clip immediately', () => {
    expect(isClipTimeSettled(61.5, 64.25, 0)).toBe(true);
  });

  it('refuses a playhead left at the end of the previous clip', () => {
    // The case that skipped a card: a clip at 10:00 finishes, the reader plays
    // one at 0:30, and for the first poll or two `getCurrentTime` is still
    // answering 600 -- which is past this clip's end, so the old code finished
    // it before it had begun.
    expect(isClipTimeSettled(600, 35, 0)).toBe(false);
    expect(isClipTimeSettled(600, 35, GRACE - 1)).toBe(false);
  });

  it('trusts a leftover reading that is merely early, since it cannot end the clip', () => {
    // A previous clip *before* this one leaves a reading below `endSeconds`.
    // Arming on it is harmless: the end check needs the playhead at or past the
    // end, so the worst it can do is hold progress at zero for a tick.
    expect(isClipTimeSettled(15, 330, 0)).toBe(true);
  });

  it('gives up waiting rather than let a clip run on unbounded', () => {
    // A seek that lands past the end -- a clip shorter than the gap between
    // keyframes -- never reports a time inside the window. Without this the
    // video would keep playing with nothing left to stop it.
    expect(isClipTimeSettled(600, 35, GRACE)).toBe(true);
    expect(isClipTimeSettled(600, 35, GRACE + 40)).toBe(true);
  });

  it('treats the end timestamp itself as unsettled', () => {
    // Boundary: `endSeconds` exactly is what `finishClip` fires on, so it must
    // not be taken from an unsettled playhead either.
    expect(isClipTimeSettled(64.25, 64.25, 0)).toBe(false);
  });
});
