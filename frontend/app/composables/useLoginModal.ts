import { type AuthSource, authIntentStorage, updateAuthIntent } from '~/utils/authAnalytics';

/**
 * Share the layout's modal across header and feature gates. Record source and park auth intent
 * here so every gate retains attribution through OAuth.
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
