/**
 * The login/signup modal lives in the default layout but is opened from the
 * header (and anywhere else that needs to prompt for auth), so its open state
 * is shared rather than local.
 */
export function useLoginModal() {
  const isLoginModalOpen = useState('nd-login-modal-open', () => false);

  return {
    isLoginModalOpen,
    openLoginModal: () => {
      isLoginModalOpen.value = true;
    },
    closeLoginModal: () => {
      isLoginModalOpen.value = false;
    },
  };
}
