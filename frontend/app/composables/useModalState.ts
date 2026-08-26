/**
 * Shared registry of the modals that are currently open.
 *
 * Components that need to know "is anything modal on screen right now?"
 * (keyboard-shortcut handlers, the audio player) read `isAnyModalOpen`
 * instead of probing the DOM. `BaseModal` is the only thing that should call
 * `registerModal`/`unregisterModal`.
 *
 * The stack doubles as the scroll-lock counter: the root scrolling element
 * (`<html>`) is locked while at least one modal is registered, so nested
 * modals can't unlock each other.
 */
let savedHtmlOverflow = '';

export function useModalState() {
  const openModals = useState<string[]>('nd-open-modals', () => []);

  const isAnyModalOpen = computed(() => openModals.value.length > 0);
  const topModalId = computed(() => openModals.value.at(-1) ?? null);
  const isTopModal = (id: string) => topModalId.value === id;

  const lockScroll = () => {
    if (!import.meta.client) return;
    const root = document.documentElement;
    savedHtmlOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  };

  const unlockScroll = () => {
    if (!import.meta.client) return;
    document.documentElement.style.overflow = savedHtmlOverflow;
  };

  const registerModal = (id: string) => {
    if (openModals.value.includes(id)) return;
    openModals.value = [...openModals.value, id];
    if (openModals.value.length === 1) lockScroll();
  };

  const unregisterModal = (id: string) => {
    if (!openModals.value.includes(id)) return;
    openModals.value = openModals.value.filter((modalId) => modalId !== id);
    if (openModals.value.length === 0) unlockScroll();
  };

  return {
    openModals,
    isAnyModalOpen,
    topModalId,
    isTopModal,
    registerModal,
    unregisterModal,
  };
}
