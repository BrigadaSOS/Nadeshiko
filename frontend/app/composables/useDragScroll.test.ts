// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { defineComponent, ref } from 'vue';

import { useDragScroll } from './useDragScroll';

/**
 * Drag-to-scroll for the horizontal rows the catalogue is built from.
 *
 * Small, and the only thing it has to get right is the direction and the
 * anchor. The offset is taken from where the pointer STARTED, not from the last
 * move -- a per-move delta accumulates rounding and drifts away from the
 * cursor -- and the row scrolls the opposite way to the pointer, because the
 * reader is dragging the content and not the viewport.
 *
 * The listeners are split deliberately: `mousedown` on the element, but `move`
 * and `up` on the window, so a drag that leaves the row still scrolls it and a
 * release outside it still ends the drag rather than leaving the row stuck to
 * the cursor.
 */
const mounted: { unmount: () => void }[] = [];

/** A scrollable row, with the geometry a drag needs. */
function row() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetLeft', { value: 20, configurable: true });
  el.scrollLeft = 100;
  document.body.appendChild(el);
  return el;
}

/** Mounts a component that wires the drag to `el`. */
function attach(el: HTMLElement | null) {
  const elRef = ref<HTMLElement | null>(el);
  const wrapper = mount(
    defineComponent({
      setup() {
        useDragScroll(elRef);
        return () => null;
      },
    }),
  );
  mounted.push(wrapper);
  return wrapper;
}

/**
 * A mouse event at `pageX`.
 *
 * `pageX` is defined onto the event rather than passed to the constructor:
 * happy-dom's `MouseEvent` ignores it in the init dict and reports 0, which
 * makes every drag in this file a drag of zero pixels -- and every assertion
 * about direction pass on an element nobody moved.
 */
function mouse(type: string, pageX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pageX', { value: pageX, configurable: true });
  return event;
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('dragging a row', () => {
  test('scrolls it the OPPOSITE way to the pointer', async () => {
    // The reader is dragging the content, not the viewport: pulling left
    // reveals what is to the right.
    const el = row();
    attach(el);

    el.dispatchEvent(mouse('mousedown', 200));
    window.dispatchEvent(mouse('mousemove', 150));

    expect(el.scrollLeft).toBe(150);
  });

  test('and the other way when the pointer goes right', async () => {
    const el = row();
    attach(el);

    el.dispatchEvent(mouse('mousedown', 200));
    window.dispatchEvent(mouse('mousemove', 260));

    expect(el.scrollLeft).toBe(40);
  });

  test('measures from where the drag STARTED, not from the last move', async () => {
    // A per-move delta accumulates rounding and drifts away from the cursor
    // over a long drag.
    const el = row();
    attach(el);

    el.dispatchEvent(mouse('mousedown', 200));
    window.dispatchEvent(mouse('mousemove', 180));
    window.dispatchEvent(mouse('mousemove', 160));
    window.dispatchEvent(mouse('mousemove', 150));

    expect(el.scrollLeft).toBe(150);
  });

  test('keeps scrolling when the pointer leaves the row', async () => {
    // `mousemove` is on the window for exactly this: a drag that leaves the row
    // would otherwise stop dead halfway.
    const el = row();
    attach(el);
    el.dispatchEvent(mouse('mousedown', 200));

    window.dispatchEvent(mouse('mousemove', 100));

    expect(el.scrollLeft).toBe(200);
  });

  test('stops the browser selecting text as the reader drags', async () => {
    // Without this a drag across a row of titles highlights every one of them.
    const el = row();
    attach(el);
    el.dispatchEvent(mouse('mousedown', 200));
    const move = mouse('mousemove', 150);

    window.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
  });

  test('shows the grabbing cursor while the drag is on', async () => {
    const el = row();
    attach(el);

    el.dispatchEvent(mouse('mousedown', 200));

    expect(el.style.cursor).toBe('grabbing');
  });
});

describe('not dragging', () => {
  test('a bare pointer move scrolls nothing', async () => {
    const el = row();
    attach(el);

    window.dispatchEvent(mouse('mousemove', 50));

    expect(el.scrollLeft).toBe(100);
  });

  test('and does not fight the browser for the selection', async () => {
    const el = row();
    attach(el);
    const move = mouse('mousemove', 50);

    window.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false);
  });

  test('releasing ends the drag and gives the cursor back', async () => {
    const el = row();
    attach(el);
    el.dispatchEvent(mouse('mousedown', 200));

    window.dispatchEvent(mouse('mouseup', 150));
    window.dispatchEvent(mouse('mousemove', 50));

    expect(el.style.cursor).toBe('');
    expect(el.scrollLeft).toBe(100);
  });

  test('a release OUTSIDE the row ends it too', async () => {
    // `mouseup` is on the window so a release anywhere lands; otherwise the row
    // stays stuck to the cursor after the button is long since up.
    const el = row();
    attach(el);
    el.dispatchEvent(mouse('mousedown', 200));

    window.dispatchEvent(mouse('mouseup', 999));
    window.dispatchEvent(mouse('mousemove', 50));

    expect(el.scrollLeft).toBe(100);
  });
});

describe('tearing down', () => {
  test('stops listening once the row is gone', async () => {
    const el = row();
    const wrapper = attach(el);
    el.dispatchEvent(mouse('mousedown', 200));

    wrapper.unmount();
    window.dispatchEvent(mouse('mousemove', 50));

    expect(el.scrollLeft).toBe(100);
  });

  test('a row that never rendered is not an error', async () => {
    // The ref is filled in by a `v-if`'d element in at least one caller.
    expect(() => attach(null)).not.toThrow();
    expect(() => window.dispatchEvent(mouse('mousemove', 50))).not.toThrow();
  });
});
