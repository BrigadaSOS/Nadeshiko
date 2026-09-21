import type { ComputedRef } from 'vue';

/**
 * Only one floating surface is open at a time: a dropdown, the search recents
 * list, or a word card. The shared state is the id of the open dropdown (or
 * recents), plus a generation that word cards watch so a newly opened menu can
 * dismiss them.
 *
 * The Shirabe card lives outside Vue's dropdown registry and watches the
 * generation so menus and modals can dismiss it.
 *
 * Modals call `dismissAllOverlays` on open so a leftover menu or word card
 * cannot sit above the dialog. `BaseModal` lets Escape dismiss a dropdown
 * inside the dialog before closing the dialog itself.
 *
 * `DropdownContainer` owns dropdown registration; consumers reach the
 * surrounding dropdown through `injectDropdown()`.
 */
export function useDropdownState() {
  const openDropdownId = useState<string | null>('nd-open-dropdown', () => null);
  const wordCardEpoch = useState('nd-word-card-epoch', () => 0);

  const dismissWordCards = () => {
    wordCardEpoch.value += 1;
  };

  const openDropdown = (id: string) => {
    openDropdownId.value = id;
    dismissWordCards();
  };

  const closeDropdown = (id: string) => {
    if (openDropdownId.value === id) openDropdownId.value = null;
  };

  const closeAllDropdowns = () => {
    openDropdownId.value = null;
  };

  const dismissAllOverlays = () => {
    closeAllDropdowns();
    dismissWordCards();
  };

  return {
    openDropdownId,
    wordCardEpoch,
    openDropdown,
    closeDropdown,
    closeAllDropdowns,
    dismissWordCards,
    dismissAllOverlays,
  };
}

export type DropdownContext = {
  id: ComputedRef<string>;
  isOpen: ComputedRef<boolean>;
  toggle: () => void;
  close: () => void;
};

export const DROPDOWN_INJECTION_KEY = 'ndDropdown' as const;

export function injectDropdown(): DropdownContext | null {
  return inject<DropdownContext | null>(DROPDOWN_INJECTION_KEY, null);
}
