/**
 * One `resize` listener for the page, reporting only that the viewport got
 * wider or narrower.
 *
 * Two reasons it is shared rather than per component. There is one
 * `SegmentTokenText` per sentence, so a page of results was registering thirty
 * listeners that all did the same arithmetic on the same event to reach the same
 * answer. And the *width-only* rule below is a decision worth stating once: it
 * is subtle, and thirty copies of a subtlety is thirty chances to fix one of
 * them.
 *
 * Why width only. A rotation or a resized window genuinely invalidates where an
 * open word card sits: it can be off the side of a narrower screen or on the
 * wrong side of a shorter one, and leaving it there is the wrong answer. But
 * mobile browsers also fire `resize` as the URL bar collapses during an ordinary
 * SCROLL -- a ~60px height change, enough to tip a marginal card onto the other
 * side of its word. The reader would be scrolling, not resizing, and the card
 * would jump: exactly the behaviour `cardPlacement` exists to prevent. A URL bar
 * does not change the width, so the width tells the two apart.
 */

const subscribers = new Set<() => void>();

let width = 0;
let frame: number | null = null;
let listening = false;

function onResize(): void {
  // Height-only: not a resize as far as anything here is concerned.
  if (window.innerWidth === width) return;
  // One notification per frame. A drag-resize fires `resize` far faster than
  // anything needs recomputing, and every subscriber writes layout.
  if (frame !== null) return;

  frame = requestAnimationFrame(() => {
    frame = null;
    width = window.innerWidth;
    for (const notify of subscribers) notify();
  });
}

function stopListening(): void {
  window.removeEventListener('resize', onResize);
  listening = false;
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
}

/**
 * Run `callback` whenever the viewport's width changes, for as long as the
 * calling component is mounted.
 *
 * Registers on mount rather than immediately, so this is safe to call during
 * setup on the server, where there is no window to listen to.
 */
export function onViewportWidthChange(callback: () => void): void {
  onMounted(() => {
    subscribers.add(callback);
    if (listening) return;
    // Seed from the viewport as it is now, so the first resize is measured
    // against reality rather than against zero.
    width = window.innerWidth;
    window.addEventListener('resize', onResize);
    listening = true;
  });

  onBeforeUnmount(() => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && listening) stopListening();
  });
}
