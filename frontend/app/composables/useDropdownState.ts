import type { ComputedRef } from 'vue';

/**
 * Share dropdown/recents identity and a word-card dismissal generation. Nested Anki menus use
 * preserveTokenTooltip to keep their card open. Modals dismiss overlays; Escape closes nested
 * overlays before the dialog. DropdownContainer owns registration, exposed by injectDropdown().
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
