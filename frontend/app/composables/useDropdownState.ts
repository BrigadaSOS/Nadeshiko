import type { ComputedRef } from 'vue';

/**
 * Only one floating surface is open at a time: a dropdown, the search recents
 * list, or a word card. The shared state is the id of the open dropdown (or
 * recents), plus a generation that word cards watch so a newly opened menu can
 * dismiss them.
 *
 * Word cards are not ids in `openDropdownId` because one of them hosts a
 * dropdown of its own (the Anki menu on a mined word). That nested menu has to
 * open without collapsing the card it lives in, so the card stays local state
 * and menus opt out of dismissing it via `preserveTokenTooltip`.
 *
 * Modals call `dismissAllOverlays` on open so a leftover menu or word card
 * cannot sit above the dialog. `BaseModal` also lets Escape dismiss a word
 * card or dropdown inside the dialog before closing the dialog itself.
 *
 * `DropdownContainer` owns dropdown registration; consumers reach the
 * surrounding dropdown through `injectDropdown()`.
 */
export function useDropdownState() {
  const openDropdownId = useState<string | null>('nd-open-dropdown', () => null);
  const tokenTooltipEpoch = useState('nd-token-tooltip-epoch', () => 0);
  const isTokenTooltipOpen = useState('nd-token-tooltip-open', () => false);

  const dismissTokenTooltips = () => {
    tokenTooltipEpoch.value += 1;
    isTokenTooltipOpen.value = false;
  };

  const openDropdown = (id: string, options?: { preserveTokenTooltip?: boolean }) => {
    openDropdownId.value = id;
    if (!options?.preserveTokenTooltip) dismissTokenTooltips();
  };

  const closeDropdown = (id: string) => {
    if (openDropdownId.value === id) openDropdownId.value = null;
  };

  const closeAllDropdowns = () => {
    openDropdownId.value = null;
  };

  const dismissAllOverlays = () => {
    closeAllDropdowns();
    dismissTokenTooltips();
  };

  return {
    openDropdownId,
    tokenTooltipEpoch,
    isTokenTooltipOpen,
    openDropdown,
    closeDropdown,
    closeAllDropdowns,
    dismissTokenTooltips,
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

/**
 * Provided by the word card so a dropdown rendered inside it (the Anki menu
 * on a mined word) can open without collapsing the card.
 */
export const NESTED_IN_TOKEN_TOOLTIP_KEY = 'ndNestedInTokenTooltip' as const;

export function injectDropdown(): DropdownContext | null {
  return inject<DropdownContext | null>(DROPDOWN_INJECTION_KEY, null);
}
