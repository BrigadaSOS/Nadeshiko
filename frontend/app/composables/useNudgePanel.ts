import { POSITION, useToast } from 'vue-toastification';
import SignupNudgeToast from '~/components/common/SignupNudgeToast.vue';

export interface NudgePanel {
  /** An `@mdi/js` path. The mark of the thing being offered, not a generic alert glyph. */
  iconPath: string;
  title: string;
  message: string;
  actionLabel: string;
  dismissLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * Keep the Vue component outside toast.ts: apiError imports it into bare-Node tests. Disable
 * library chrome and click/drag dismissal so the panel's own controls remain authoritative.
 */
export function raiseNudgePanel(panel: NudgePanel) {
  const toaster = useToast();

  const id = toaster(
    {
      component: SignupNudgeToast,
      props: {
        iconPath: panel.iconPath,
        title: panel.title,
        message: panel.message,
        actionLabel: panel.actionLabel,
        dismissLabel: panel.dismissLabel,
      },
      listeners: {
        action: () => {
          toaster.dismiss(id);
          panel.onAction();
        },
        dismiss: () => {
          toaster.dismiss(id);
          panel.onDismiss();
        },
      },
    },
    {
      // A proposal stays until the reader answers or dismisses it; no timeout also avoids the
      // library's animation-driven progress-bar close.
      timeout: false,
      // Bottom-LEFT, alone among this app's toasts. The opposite corner belongs
      // to `FabDock`, which stacks feedback and the page's own buttons there and
      // slides up to clear the player bar; a panel this size would bury that
      // column. Status toasts stay on the right, which also keeps a proposal
      // visually distinct from a report.
      position: POSITION.BOTTOM_LEFT,
      toastClassName: 'nd-toast-nudge',
      icon: false,
      closeButton: false,
      closeOnClick: false,
      draggable: false,
    },
  );
}
