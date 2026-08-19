import { describe, expect, it } from 'vitest';
import { ENGAGED_VIEW_DWELL_MS, createEngagedViewGate } from '~/utils/engagedView';

describe('createEngagedViewGate', () => {
  it('does not count a view that leaves before the threshold', () => {
    // The scraper case: the page is fetched, JavaScript runs, and the client is
    // gone well inside a single dwell window.
    const gate = createEngagedViewGate(ENGAGED_VIEW_DWELL_MS, true, 0);

    expect(gate.claim(ENGAGED_VIEW_DWELL_MS - 1)).toBe(false);
  });

  it('counts a view once the threshold is reached', () => {
    const gate = createEngagedViewGate(ENGAGED_VIEW_DWELL_MS, true, 0);

    expect(gate.claim(ENGAGED_VIEW_DWELL_MS)).toBe(true);
  });

  it('counts a view at most once', () => {
    const gate = createEngagedViewGate(1000, true, 0);

    expect(gate.claim(1000)).toBe(true);
    expect(gate.claim(5000)).toBe(false);
  });

  it('accrues nothing while the tab is in the background', () => {
    // A permalink opened into a background tab from Discord. Wall-clock time
    // passes, but nobody has looked at it, so it must not qualify.
    const gate = createEngagedViewGate(1000, false, 0);

    expect(gate.claim(60_000)).toBe(false);
    expect(gate.elapsed(60_000)).toBe(0);
  });

  it('starts counting when a backgrounded tab is brought forward', () => {
    const gate = createEngagedViewGate(1000, false, 0);

    gate.setVisible(true, 60_000);

    expect(gate.claim(60_999)).toBe(false);
    expect(gate.claim(61_000)).toBe(true);
  });

  it('sums foreground time across several visits to the tab', () => {
    // Read in two sittings, neither long enough on its own.
    const gate = createEngagedViewGate(1000, true, 0);

    gate.setVisible(false, 600);
    gate.setVisible(true, 10_000);

    expect(gate.elapsed(10_300)).toBe(900);
    expect(gate.claim(10_300)).toBe(false);
    expect(gate.claim(10_400)).toBe(true);
  });

  it('does not accrue time while hidden between two sittings', () => {
    const gate = createEngagedViewGate(ENGAGED_VIEW_DWELL_MS, true, 0);

    gate.setVisible(false, 500);

    // Half an hour in the background contributes nothing.
    expect(gate.elapsed(1_800_000)).toBe(500);
  });

  it('ignores a repeated visible transition rather than restarting the clock', () => {
    // Browsers can fire `visibilitychange` more than once for the same state;
    // treating the second one as a fresh start would rewind the reader's progress.
    const gate = createEngagedViewGate(1000, true, 0);

    gate.setVisible(true, 900);

    expect(gate.claim(1000)).toBe(true);
  });

  it('ignores a repeated hidden transition rather than double-counting', () => {
    const gate = createEngagedViewGate(1000, true, 0);

    gate.setVisible(false, 400);
    gate.setVisible(false, 900);

    expect(gate.elapsed(900)).toBe(400);
  });

  it('treats a clock that runs backwards as no elapsed time', () => {
    // `Date.now()` is not monotonic; a mid-view system clock adjustment must not
    // produce a negative contribution that cancels out real reading time.
    const gate = createEngagedViewGate(1000, true, 1000);

    expect(gate.elapsed(0)).toBe(0);

    gate.setVisible(false, 0);

    expect(gate.elapsed(0)).toBe(0);
  });
});
