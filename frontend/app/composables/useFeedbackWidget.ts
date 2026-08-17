/**
 * Shared open state for the feedback panel.
 *
 * The panel renders once, in the default layout, but is opened from three places
 * that are nowhere near it in the tree: the floating button in the corner dock,
 * the navigation drawer (the way in on a phone, where the button is hidden
 * rather than left sitting on top of the player bar), and the footer link.
 * Shared state is what lets those exist without the panel being mounted thrice.
 */
export function useFeedbackWidget() {
  const isFeedbackOpen = useState('nd-feedback-open', () => false);

  return {
    isFeedbackOpen,
    openFeedback: () => {
      isFeedbackOpen.value = true;
    },
    closeFeedback: () => {
      isFeedbackOpen.value = false;
    },
  };
}
