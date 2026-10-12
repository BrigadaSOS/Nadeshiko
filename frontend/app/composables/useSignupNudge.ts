import { mdiAccountPlusOutline, mdiFileDocumentPlusOutline } from '@mdi/js';
import { type AuthGate, authIntentStorage } from '~/utils/authAnalytics';
import { raiseNudgePanel } from './useNudgePanel';
import {
  NUDGE_BY_TRIGGER,
  type NudgeTrigger,
  depthReached,
  isNudgeDue,
  recordNudgeDismissed,
  recordNudgeShown,
} from '~/utils/signupNudges';

/**
 * Which gate a signup gets attributed to when the reader accepts the panel.
 *
 * A map rather than a conditional so that adding a trigger without deciding how
 * its signups should be credited is a type error rather than a quiet fold into
 * whichever branch happened to be the default.
 */
const GATE_BY_TRIGGER: Record<NudgeTrigger, AuthGate> = {
  download: 'download_nudge',
  add_menu: 'add_nudge',
  depth: 'depth_nudge',
};

/**
 * Browser orchestration for the pure signupNudges rules. useState shares counters across
 * components and routes; declinable toasts avoid interrupting the reader's activity.
 */
export function useSignupNudge() {
  /**
   * Nudge failures must not break the requested action. Guard counters as well as UI: useState
   * can throw when reached outside an active Nuxt context.
   */
  function guarded(step: () => void) {
    if (!import.meta.client) return;
    try {
      step();
    } catch {
      // Never the reason the reader's actual action failed.
    }
  }

  // Count activity within this visit, not across a persisted lifetime, so the depth ask
  // reflects current engagement.
  const plays = () => useState('nd-nudge-plays', () => 0);
  const searches = () => useState('nd-nudge-searches', () => 0);

  /**
   * Shows the panel a trigger asks for, unless that panel is on cooldown or the
   * reader is already signed in.
   *
   * The signed-in check is here rather than at each call site so that a new call
   * site cannot forget it -- the same reasoning that put `login_modal_opened`
   * inside `useLoginModal` instead of at every gate.
   *
   * Assumes it is already inside `guarded`.
   */
  function show(trigger: NudgeTrigger) {
    if (userStore().isLoggedIn) return;

    // Two triggers share the `download` panel, and so share its cooldown -- the
    // reader who saves a clip and then opens the add menu has been asked once.
    // A reader who meets a *different* panel in the same sitting is covered by
    // the quiet period inside `isNudgeDue`, not here.
    const nudge = NUDGE_BY_TRIGGER[trigger];
    const storage = authIntentStorage();
    const now = Date.now();
    if (!isNudgeDue(storage, nudge, now)) return;

    // Recorded before the toast rather than after, so a throw inside the toast
    // library cannot leave a nudge that re-fires on every download.
    const askNumber = recordNudgeShown(storage, nudge, now);

    // This is what makes the cooldown legible from the outside: without it a
    // quiet week looks identical to a broken trigger, and the funnel from ask to
    // account would have no denominator. `ask_number` is the one that decides
    // whether the ladder should exist at all -- a second ask that converts like
    // the first justifies repeating, one that converts at nothing says stop.
    usePostHog()?.capture('signup_nudge_shown', { nudge, trigger, ask_number: askNumber });

    const { $i18n } = useNuxtApp();
    raiseNudgePanel({
      // The mark of the thing being offered rather than a generic alert glyph:
      // `mdiFileDocumentPlusOutline` is already what the segment menu and the
      // word card use for Anki, so a reader who has seen the disabled menu entry
      // meets the same symbol here, now attached to something they can press.
      iconPath: nudge === 'download' ? mdiFileDocumentPlusOutline : mdiAccountPlusOutline,
      title: $i18n.t(`signupNudge.${nudge}.title`),
      message: $i18n.t(`signupNudge.${nudge}.message`),
      actionLabel: $i18n.t('signupNudge.action'),
      dismissLabel: $i18n.t('signupNudge.dismiss'),
      onAction: () => openLoginModalFor(trigger),
      // Without this, a reader who read the panel and said no is indistinguishable
      // from one who never looked at it -- both are simply an absence after
      // `signup_nudge_shown`. That is the difference between copy that is not
      // landing and copy that is not being seen, which is the first thing anyone
      // will want to know from this experiment.
      onDismiss: () => {
        // Guarded again rather than relying on the wrapper around `show`: this
        // runs whenever the reader gets round to pressing the button, which is
        // long after that call stack is gone.
        guarded(() => {
          // A pressed "Not now" ends the ladder sooner than silence does -- see
          // `asksSpent` for why the two are not worth the same.
          recordNudgeDismissed(storage, nudge);
          usePostHog()?.capture('signup_nudge_dismissed', { nudge, trigger, ask_number: askNumber });
        });
      },
    });
  }

  /**
   * Resolved at click time rather than when the toast is built, because the
   * modal state this touches is shared and the reader may have signed in from
   * somewhere else in the seconds the toast was on screen.
   */
  function openLoginModalFor(trigger: NudgeTrigger) {
    if (userStore().isLoggedIn) return;
    useLoginModal().openLoginModal(GATE_BY_TRIGGER[trigger]);
  }

  return {
    /** Called after a clip is saved. The ask is Anki, because that is what an account adds. */
    nudgeAfterDownload() {
      guarded(() => show('download'));
    },

    /**
     * Explain the add-menu login gate without requiring a tooltip hover. The toggle fires on
     * close too; the shared cooldown makes subsequent clicks harmless.
     */
    nudgeOnAddMenu() {
      guarded(() => show('add_menu'));
    },

    /**
     * The caller excludes autoplay so one click's automatic playlist does not trigger a depth
     * ask.
     */
    recordPlay() {
      guarded(() => {
        const counted = plays();
        counted.value += 1;
        if (depthReached({ plays: counted.value, searches: searches().value })) show('depth');
      });
    },

    recordSearch() {
      guarded(() => {
        const counted = searches();
        counted.value += 1;
        if (depthReached({ plays: plays().value, searches: counted.value })) show('depth');
      });
    },
  };
}
