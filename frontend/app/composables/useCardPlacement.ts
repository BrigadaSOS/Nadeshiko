import { ref } from 'vue';
import { placeCard } from '~/utils/cardPlacement';

/**
 * Where the word card sits, and when that is recomputed.
 *
 * `isOpen` and `anchor` are read through getters rather than passed as values,
 * because both change under the card while it is open and this has to see the
 * current one -- the anchor especially, which is the token element the reader
 * last pressed.
 */
export function useCardPlacement(anchor: () => HTMLElement | null, isOpen: () => boolean) {
  const tooltipStyle = ref<Record<string, string>>({});
  // Which side of the token the card hangs off. Decided once when it opens and
  // never revisited -- see `placeTooltip`.
  const tooltipBelow = ref(false);

  /**
   * Put the card where the word is, once and for good.
   *
   * The decision itself is `placeCard`, which measures nothing: see the reasoning
   * there for why the side is settled before the card has any content, and why it
   * is never revisited when the content arrives.
   *
   * All this adds is the page scroll, because the card is placed on the PAGE
   * rather than on the screen. It therefore scrolls away with the sentence it
   * belongs to instead of following the reader down the page, and nothing has to
   * re-run on scroll to keep it honest.
   */
  function placeTooltip(): void {
    const element = anchor();
    if (!element?.isConnected) return;
    const tokenRect = element.getBoundingClientRect();

    const placement = placeCard(tokenRect, { width: window.innerWidth, height: window.innerHeight });

    tooltipBelow.value = placement.below;
    tooltipStyle.value = {
      left: `${placement.left + window.scrollX}px`,
      top: `${placement.top + window.scrollY}px`,
      maxHeight: `${placement.maxHeight}px`,
    };
  }

  // Re-place an open card when the viewport is resized. One listener serves every
  // sentence on the page, and it fires only on a WIDTH change -- see
  // `onViewportWidthChange` for why a height-only change must not reach here.
  onViewportWidthChange(() => {
    if (!isOpen()) return;
    placeTooltip();
  });

  return { tooltipStyle, tooltipBelow, placeTooltip };
}
