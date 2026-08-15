import { type AuthSource, authIntentStorage, updateAuthIntent } from '~/utils/authAnalytics';

/**
 * The login/signup modal lives in the default layout but is opened from the
 * header, and from every feature gate a signed-out reader runs into, so its open
 * state is shared rather than local.
 *
 * Opening it is also the only moment at which we know *why* the reader is being
 * asked to sign in, so this is where that gets recorded -- both to PostHog and
 * into the parked intent that carries it across the OAuth redirect. Doing it here
 * rather than at each call site is what keeps `login_modal_opened` and
 * `signup_completed` describing the same journey: a new gate cannot be wired up
 * and silently forget to report itself.
 */
export function useLoginModal() {
  const isLoginModalOpen = useState('nd-login-modal-open', () => false);
  const loginModalSource = useState<AuthSource>('nd-login-modal-source', () => 'unknown');

  return {
    isLoginModalOpen,
    loginModalSource,

    /**
     * @param source What sent the reader here. A gate name when they hit a wall,
     * `header` when they went looking for the login button themselves. The
     * difference between those two is the entire question this instrumentation
     * exists to answer, so it is required rather than defaulted.
     */
    openLoginModal: (source: AuthSource) => {
      loginModalSource.value = source;
      isLoginModalOpen.value = true;

      if (!import.meta.client) return;

      const gate = source === 'header' || source === 'unknown' ? undefined : source;
      updateAuthIntent(authIntentStorage(), { source, gate }, Date.now());
      usePostHog()?.capture('login_modal_opened', { source, gate: gate ?? null });
    },

    closeLoginModal: () => {
      isLoginModalOpen.value = false;
    },
  };
}
