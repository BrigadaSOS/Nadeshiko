/**
 * Where a teleported dropdown sits, from the trigger and the menu size.
 *
 * Teleported menus leave their overflow/sticky ancestor (a scrolling table,
 * a clipped chip row) and paint on `body`. Placement is viewport-fixed:
 * below the trigger by default, flipped above when that side is roomier,
 * then clamped so a last-row menu cannot run off the screen.
 */

export const DROPDOWN_GAP = 6;
export const DROPDOWN_MARGIN = 8;

export type DropdownAlign = 'start' | 'end';

export interface DropdownAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DropdownBox {
  width: number;
  height: number;
}

export interface DropdownViewport {
  width: number;
  height: number;
}

export function placeDropdownMenu(
  trigger: DropdownAnchor,
  menu: DropdownBox,
  viewport: DropdownViewport,
  align: DropdownAlign = 'start',
): { top: number; left: number } {
  let top = trigger.bottom + DROPDOWN_GAP;
  if (menu.height > 0) {
    const roomBelow = viewport.height - DROPDOWN_MARGIN - (trigger.bottom + DROPDOWN_GAP);
    const roomAbove = trigger.top - DROPDOWN_GAP - DROPDOWN_MARGIN;
    if (roomBelow < menu.height && roomAbove > roomBelow) {
      top = trigger.top - DROPDOWN_GAP - menu.height;
    }
    top = Math.max(DROPDOWN_MARGIN, Math.min(top, viewport.height - DROPDOWN_MARGIN - menu.height));
  }

  let left = align === 'end' ? trigger.right - menu.width : trigger.left;
  if (menu.width > 0) {
    left = Math.max(DROPDOWN_MARGIN, Math.min(left, viewport.width - DROPDOWN_MARGIN - menu.width));
  }

  return { top, left };
}
