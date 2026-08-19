/**
 * Decides whether a permalink was actually *looked at*, rather than merely
 * fetched.
 *
 * This is what separates `shared_link_read` from `shared_link_viewed` in
 * `pages/sentence/[id].vue`. Both fire for the same visit; only the first
 * requires that somebody stayed. See that file for why the distinction is drawn
 * at query time rather than by suppressing the event.
 *
 * The distinction stopped being academic in August 2026, when two scrapers began
 * walking the permalink space: over three days they produced 540 and 517 events
 * from 540 and 517 distinct persons — one event each, each on a different
 * segment, 1.2% of them touching anything else on the site. They execute
 * JavaScript and send ordinary Chrome user agents, so neither PostHog's
 * `isLikelyBot` nor a user-agent filter of our own sees them; the only thing that
 * separates them from a reader is that a reader stays.
 *
 * So the signal is dwell: foreground time on the page. A client that loads and
 * leaves never reaches the threshold, and no allow-list has to be kept up to date
 * for that to keep working.
 *
 * Foreground time, specifically, and not wall-clock. A permalink opened into a
 * background tab — the normal fate of a link opened from Discord — would clear a
 * wall-clock threshold while nobody had yet looked at it, and would then be
 * indistinguishable from the scrapers this exists to exclude. Time only
 * accumulates while the tab is visible, so the reader who opens six links and
 * reads them one at a time is counted six times, once per link they actually
 * read.
 *
 * Everything here is pure so it can be tested without a browser: the caller
 * supplies visibility transitions and the clock.
 */

/**
 * How much foreground time counts as "looked at".
 *
 * Chosen against the two populations it has to separate rather than as a round
 * number. The scrapers are gone within a load; a reader arriving on a permalink
 * has to wait out an SSR render and then read a Japanese sentence with its
 * translation, which is already several seconds.
 *
 * It is worth being honest that this number is reasoned rather than measured.
 * The attempt to measure it did not succeed: of 378 permalink sessions belonging
 * to readers who searched, played or exported at some point, 75 consist of a
 * single event and so have no measurable span at all, and among the rest roughly
 * 7% fall under 2.5s. Whether those are hurried readers or unlucky sampling is
 * not answerable from event timestamps.
 *
 * That uncertainty is survivable only because of how this is wired up. Nothing is
 * suppressed on the strength of this constant -- `shared_link_viewed` fires
 * regardless -- so getting it wrong costs accuracy on a second, additive series
 * that can be re-cut against the first at query time. It would not have been
 * survivable in the design this replaced, where the same doubt would have been
 * deleting readers permanently and invisibly.
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
