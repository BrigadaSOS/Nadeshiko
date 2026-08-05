import type { ComputedRef } from 'vue';

/**
 * Only one dropdown menu is open at a time, so the shared state is just the id
 * of the open one. `DropdownContainer` owns the registration; consumers reach
 * the surrounding dropdown through `injectDropdown()`.
 */
export function useDropdownState() {
  const openDropdownId = useState<string | null>('nd-open-dropdown', () => null);

  const openDropdown = (id: string) => {
    openDropdownId.value = id;
  };

  const closeDropdown = (id: string) => {
    if (openDropdownId.value === id) openDropdownId.value = null;
  };

  const closeAllDropdowns = () => {
    openDropdownId.value = null;
  };

  return { openDropdownId, openDropdown, closeDropdown, closeAllDropdowns };
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
