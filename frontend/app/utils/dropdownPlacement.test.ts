import { describe, expect, it } from 'vitest';
import { DROPDOWN_GAP, DROPDOWN_MARGIN, placeDropdownMenu } from './dropdownPlacement';

const viewport = { width: 1000, height: 800 };
const menu = { width: 200, height: 160 };
const trigger = { top: 100, bottom: 132, left: 400, right: 440 };

describe('placeDropdownMenu', () => {
  it('sits below the trigger, start-aligned', () => {
    expect(placeDropdownMenu(trigger, menu, viewport, 'start')).toEqual({
      top: trigger.bottom + DROPDOWN_GAP,
      left: trigger.left,
    });
  });

  it('sits below the trigger, end-aligned', () => {
    expect(placeDropdownMenu(trigger, menu, viewport, 'end')).toEqual({
      top: trigger.bottom + DROPDOWN_GAP,
      left: trigger.right - menu.width,
    });
  });

  it('flips above when there is more room up than down', () => {
    const low = { top: 700, bottom: 732, left: 400, right: 440 };
    expect(placeDropdownMenu(low, menu, viewport, 'start').top).toBe(low.top - DROPDOWN_GAP - menu.height);
  });

  it('clamps a menu that would hang off the right edge', () => {
    const right = { top: 100, bottom: 132, left: 980, right: 1000 };
    expect(placeDropdownMenu(right, menu, viewport, 'end').left).toBe(viewport.width - DROPDOWN_MARGIN - menu.width);
  });

  it('does not flip when height is still unknown', () => {
    const low = { top: 700, bottom: 732, left: 400, right: 440 };
    expect(placeDropdownMenu(low, { width: 200, height: 0 }, viewport, 'start').top).toBe(low.bottom + DROPDOWN_GAP);
  });
});
