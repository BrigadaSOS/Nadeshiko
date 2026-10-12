import { ref } from 'vue';
import { placeCard } from '~/utils/cardPlacement';

/** Read anchor and open state through getters because both can change while the card is open. */
export function useCardPlacement(anchor: () => HTMLElement | null, isOpen: () => boolean) {
  const tooltipStyle = ref<Record<string, string>>({});
  // Which side of the token the card hangs off. Decided once when it opens and
  // never revisited -- see `placeTooltip`.
  const tooltipBelow = ref(false);

  /**
   * Settle placement before content arrives; see placeCard. Add page scroll offsets so the card
   * scrolls with its sentence without recomputing.
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
