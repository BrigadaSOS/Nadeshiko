// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent } from 'vue';

/**
 * The one shared `resize` listener behind the word cards.
 *
 * The rule it exists to state once is WIDTH ONLY, and it is the kind of
 * subtlety that gets quietly reverted by anyone who reads `resize` as meaning
 * "the window changed size". Mobile browsers fire `resize` as the URL bar
 * collapses during an ordinary SCROLL -- a ~60px height change, enough to tip a
 * marginal card onto the other side of its word. The reader is scrolling, not
 * resizing, and the card jumps: exactly what `cardPlacement` exists to prevent.
 * A URL bar does not change the width, which is how the two are told apart.
 *
 * Module state is per import, so every test re-imports; otherwise one test's
 * subscribers are still registered in the next.
 */
let frames: (() => void)[] = [];
let cancelled: number[] = [];
const mounted: { unmount: () => void }[] = [];

/** Runs whatever `requestAnimationFrame` is holding, as the browser would. */
function flushFrame() {
  const due = frames;
  frames = [];
  for (const frame of due) frame();
}

/** Resizes the window and delivers the event, as the browser would. */
function resizeTo(width: number, height = 800) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

/** A component that subscribes for as long as it is mounted. */
async function subscribe(callback: () => void) {
  const { onViewportWidthChange } = await import('./useViewportWidth');
  const wrapper = mount(
    defineComponent({
      setup() {
        onViewportWidthChange(callback);
        return () => null;
      },
    }),
  );
  mounted.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.resetModules();
  frames = [];
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => frames.push(frame) as unknown as number);
  cancelled = [];
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id);
    frames = [];
  });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.unstubAllGlobals();
  // Restored, not just cleared: `vi.spyOn` hands back the EXISTING spy when a
  // method is already spied, so a listener count taken in one test otherwise
  // still holds the previous test's calls -- which reads as a leaked listener
  // that is not there.
  vi.restoreAllMocks();
});

describe('a genuine resize', () => {
  test('tells the subscriber the viewport got narrower', async () => {
    // A card can be off the side of a narrower screen; leaving it there is the
    // wrong answer.
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(600);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(1);
  });

  test('and wider', async () => {
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(1400);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(1);
  });

  test('tells every subscriber, which is a page of sentences', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await subscribe(first);
    await subscribe(second);

    resizeTo(600);
    flushFrame();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('through ONE listener, not one per sentence on the page', async () => {
    // A page of results was registering thirty listeners doing the same
    // arithmetic on the same event to reach the same answer.
    const add = vi.spyOn(window, 'addEventListener');

    await subscribe(vi.fn());
    await subscribe(vi.fn());
    await subscribe(vi.fn());

    expect(add.mock.calls.filter(([type]) => String(type) === 'resize')).toHaveLength(1);
  });
});

describe('a HEIGHT-only resize', () => {
  test('is ignored, because that is a mobile URL bar during a scroll', async () => {
    // The reader is scrolling. Recomputing placement here makes an open card
    // jump to the other side of its word mid-scroll.
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(1000, 740);
    flushFrame();

    expect(notified).not.toHaveBeenCalled();
  });

  test('is ignored however many times it fires', async () => {
    // It fires continuously through a scroll.
    const notified = vi.fn();
    await subscribe(notified);

    for (const height of [780, 760, 740, 800]) resizeTo(1000, height);
    flushFrame();

    expect(notified).not.toHaveBeenCalled();
  });

  test('but a rotation, which changes both, is a real resize', async () => {
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(800, 1000);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('the width it compares against', () => {
  test('is seeded on mount, so the first resize is measured against reality', async () => {
    // Seeded from zero, the first event after mount always looks like a width
    // change -- including the URL-bar one this exists to ignore.
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(1000, 700);
    flushFrame();

    expect(notified).not.toHaveBeenCalled();
  });

  test('moves with each real resize, so a return to the old width still counts', async () => {
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(600);
    flushFrame();
    resizeTo(1000);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(2);
  });
});

describe('a burst of resizes', () => {
  test('is one notification per frame, not one per event', async () => {
    // A drag-resize fires far faster than anything needs recomputing, and
    // every subscriber writes layout.
    const notified = vi.fn();
    await subscribe(notified);

    for (const width of [900, 800, 700, 600]) resizeTo(width);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(1);
  });

  test('and the next frame can notify again', async () => {
    const notified = vi.fn();
    await subscribe(notified);

    resizeTo(900);
    flushFrame();
    resizeTo(800);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(2);
  });

  test('reports the width as it was at the END of the burst', async () => {
    const notified = vi.fn();
    await subscribe(notified);

    for (const width of [900, 800, 700]) resizeTo(width);
    flushFrame();
    // Settling back to 700 is not a change; a stale stored width would make it
    // look like one.
    resizeTo(700);
    flushFrame();

    expect(notified).toHaveBeenCalledTimes(1);
  });
});

describe('unmounting', () => {
  test('stops notifying a component that has gone', async () => {
    const notified = vi.fn();
    const wrapper = await subscribe(notified);

    wrapper.unmount();
    resizeTo(600);
    flushFrame();

    expect(notified).not.toHaveBeenCalled();
  });

  test('keeps notifying the ones still there', async () => {
    const going = vi.fn();
    const staying = vi.fn();
    const wrapper = await subscribe(going);
    await subscribe(staying);

    wrapper.unmount();
    resizeTo(600);
    flushFrame();

    expect(going).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);
  });

  test('drops the listener once the last subscriber goes', async () => {
    // Otherwise every page of results the reader visits leaves one behind.
    const remove = vi.spyOn(window, 'removeEventListener');
    const wrapper = await subscribe(vi.fn());

    wrapper.unmount();

    expect(remove.mock.calls.filter(([type]) => String(type) === 'resize')).toHaveLength(1);
  });

  test('but not while others are still listening', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const wrapper = await subscribe(vi.fn());
    await subscribe(vi.fn());

    wrapper.unmount();

    expect(remove.mock.calls.filter(([type]) => String(type) === 'resize')).toHaveLength(0);
  });

  test('cancels a frame it had already scheduled', async () => {
    // Nothing is left to notify, so the queued callback is pure layout work
    // for a page that has gone -- and the reader is mid-navigation when it
    // runs.
    const notified = vi.fn();
    const wrapper = await subscribe(notified);

    resizeTo(600);
    wrapper.unmount();

    expect(cancelled).toHaveLength(1);
    flushFrame();
    expect(notified).not.toHaveBeenCalled();
  });

  test('cancels nothing when no frame is pending', async () => {
    // `cancelAnimationFrame(null)` is the shape that throws in older engines.
    const wrapper = await subscribe(vi.fn());

    wrapper.unmount();

    expect(cancelled).toHaveLength(0);
  });
});
