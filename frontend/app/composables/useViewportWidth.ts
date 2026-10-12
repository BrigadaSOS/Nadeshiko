/**
 * Share one width-change listener across word cards. Ignore height-only resize events from a
 * mobile URL bar collapsing during scroll, which must not reposition an open card.
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
