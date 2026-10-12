/**
 * Accumulate visible-tab dwell, not wall-clock time, to distinguish read pages from fetch-only visits.
 * Background links accrue nothing until viewed. Callers supply visibility changes and time.
 */

/**
 * Reasoned 2.5s foreground threshold, not a measured cutoff. Event timestamps could not reliably classify
 * short reader sessions. Keep engagement additive to raw views so uncertainty does not discard visits.
 */
export const ENGAGED_VIEW_DWELL_MS = 2500;

export interface EngagedViewGate {
  /**
   * Records a visibility transition. Safe to call with the same state twice; only
   * changes advance the accumulator.
   */
  setVisible(visible: boolean, now: number): void;
  /**
   * Whether the dwell threshold has been reached. Returns `true` at most once per
   * gate, so the caller can poll it without having to track "already reported"
   * itself.
   */
  claim(now: number): boolean;
  /** Foreground milliseconds accumulated so far. Exposed for tests and debugging. */
  elapsed(now: number): number;
}

/**
 * Builds a gate that accumulates foreground time.
 *
 * @param dwellMs Foreground milliseconds required before a view counts.
 * @param initiallyVisible Whether the document was visible when the gate was
 * created. A permalink opened into a background tab starts `false` and accrues
 * nothing until it is brought forward.
 * @param now The creation timestamp, in epoch milliseconds.
 */
export function createEngagedViewGate(
  dwellMs: number = ENGAGED_VIEW_DWELL_MS,
  initiallyVisible: boolean = true,
  now: number = 0,
): EngagedViewGate {
  let visibleSince: number | null = initiallyVisible ? now : null;
  let accumulated = 0;
  let claimed = false;

  const elapsed = (at: number): number => accumulated + (visibleSince === null ? 0 : Math.max(0, at - visibleSince));

  return {
    setVisible(visible: boolean, at: number): void {
      if (visible) {
        // Already counting: a repeated `visible` must not reset the start mark, or
        // a browser that fires `visibilitychange` more than once would rewind the
        // reader's progress back to zero each time.
        if (visibleSince === null) visibleSince = at;
        return;
      }

      if (visibleSince === null) return;
      accumulated += Math.max(0, at - visibleSince);
      visibleSince = null;
    },

    claim(at: number): boolean {
      if (claimed) return false;
      if (elapsed(at) < dwellMs) return false;

      claimed = true;
      return true;
    },

    elapsed,
  };
}
