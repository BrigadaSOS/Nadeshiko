/**
 * Share open state across dock, drawer, and footer while mounting the panel once in the default
 * layout.
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
