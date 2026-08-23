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
 * Raises a proposal as a panel rather than as one of the bars in `~/utils/toast`.
 *
 * It lives in its own file rather than beside those three because it is the only
 * thing in the app that renders a component into a toast, and `toast.ts` is
 * imported by `apiError.ts` -- which puts it in the import graph of tests that
 * run in a bare Node environment with no Vue plugin. A `.vue` import there breaks
 * three unrelated test files. Keeping the component reference here, in a file no
 * test imports, is what keeps that graph clean. Extracted from
 * `useSignupNudge` when a second caller appeared; the reasoning below is that
 * file's, and it applies unchanged to any panel that asks the reader something.
 *
 * Every piece of the library's own chrome is off: its icon and close button
 * would sit alongside the panel's own, its click-to-close would fire whenever a
 * reader went for the dismiss button, and dragging a panel with two controls in
 * it is a way to press neither.
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
      // Never auto-dismisses. A status toast can expire because missing it costs
      // nothing -- the thing it reported already happened. This one is a
      // question, and a question that withdraws itself after twelve seconds is
      // one a reader who looked away has been asked and never got to answer. It
      // leaves when they decide it does, by either button.
      //
      // A pleasant side effect: with no timeout the library renders no progress
      // bar at all, so the trap that bar carries -- it drives the close via its
      // own `animationend`, and its `opacity` is written inline where no
      // stylesheet can reach it -- stops being ours to work around.
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
