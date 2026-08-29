// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

import FilterPanelShell from './FilterPanelShell.vue';

/**
 * The chrome every sidebar filter panel is built out of.
 *
 * Almost all of it is markup, and the one piece that is not -- the scrollbar
 * gutter the header pads itself by -- is the reason this file exists. It is a
 * measurement of the live layout, so nothing about it is visible in the source:
 * the header either lines its counts up with the rows' counts or it does not,
 * and on a machine with overlay scrollbars (every Mac, which is every machine
 * this is developed on) the gutter is 0 and every version of the code looks
 * right.
 *
 * The geometry is therefore driven from here. `getBoundingClientRect` reports
 * the border box and `clientWidth` the content box, and their difference IS the
 * scrollbar; happy-dom reports 0 for both, which would make every assertion pass
 * on a gutter that never appeared.
 */
const geometry = { border: 0, content: 0 };

/** Frames, held rather than run, so "on the NEXT frame" is a thing a test can see. */
let frames: (() => void)[] = [];
let observerCallbacks: (() => void)[] = [];
const disconnect = vi.fn();

/** Runs whatever `requestAnimationFrame` is holding, as the browser would. */
async function flushFrame() {
  const due = frames;
  frames = [];
  for (const frame of due) frame();
  await nextTick();
}

class FakeResizeObserver {
  constructor(callback: () => void) {
    observerCallbacks.push(callback);
  }
  observe() {}
  disconnect() {
    disconnect();
  }
}

beforeEach(() => {
  geometry.border = 0;
  geometry.content = 0;
  frames = [];
  observerCallbacks = [];
  disconnect.mockClear();

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: geometry.border }) as DOMRect,
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => geometry.content);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (frame: () => void) => frames.push(frame));
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A panel with a header row, which is the part that pads itself by the gutter. */
function render(props: { flush?: boolean } = {}, slots: Record<string, string> = {}) {
  return mount(FilterPanelShell, {
    props,
    slots: { header: '<span>Episode 3</span>', default: '<li>a row</li>', ...slots },
  });
}

/**
 * What the header reserves on its right, as the style attribute spells it.
 *
 * Awaited, because the measurement happens in `onMounted` and the re-render it
 * causes is a tick later: read synchronously, every panel reports a gutter of 0
 * and every assertion here would be about mount order rather than about
 * measurement.
 */
async function headerPadding(wrapper: ReturnType<typeof render>) {
  await nextTick();
  return wrapper.find('.bg-sgrayhover').attributes('style') ?? '';
}

/** The gutter as a number, since `padding-right` has a hyphen of its own. */
async function gutterPx(wrapper: ReturnType<typeof render>) {
  const match = /\+ (-?[\d.]+)px/.exec(await headerPadding(wrapper));
  if (!match) throw new Error(`no gutter in the header padding: ${await headerPadding(wrapper)}`);
  return Number(match[1]);
}

/** The one scrolling region: the rows, never the card around them. */
const scrollRegion = (wrapper: ReturnType<typeof render>) => wrapper.find('.overflow-y-auto');

describe('the scrollbar gutter', () => {
  test('is reserved in the header, so its counts sit over the rows’ counts', async () => {
    // A classic 15px scrollbar: the list is 15px narrower inside than out.
    geometry.border = 300;
    geometry.content = 285;

    expect(await headerPadding(render())).toContain('15px');
  });

  test('is nothing at all for a list too short to scroll', async () => {
    // Which is why it is measured rather than reserved up front -- a short list
    // should run the full width of the card.
    geometry.border = 300;
    geometry.content = 300;

    expect(await headerPadding(render())).toContain('0px');
  });

  test('is nothing on a platform with overlay scrollbars', async () => {
    // Every Mac. The gutter is real elsewhere, which is why this cannot be
    // checked by looking at the panel.
    geometry.border = 300;
    geometry.content = 300;

    expect(await gutterPx(render())).toBe(0);
  });

  test('never goes NEGATIVE, which would pull the header in instead', async () => {
    // The two widths disagree by a sub-pixel fraction even with no scrollbar in
    // play -- measured at -0.11px on a live panel. Unclamped, the header creeps
    // left of the rows on exactly the machines that have no scrollbar to pad.
    geometry.border = 299.89;
    geometry.content = 300;

    expect(await gutterPx(render())).toBe(0);
  });

  test('keeps the fraction of a fractional scrollbar', async () => {
    // `offsetWidth` is rounded to whole pixels and left the header a pixel off.
    geometry.border = 300.5;
    geometry.content = 285;

    expect(await headerPadding(render())).toContain('15.5px');
  });
});

describe('re-measuring as the list changes', () => {
  test('picks up a scrollbar that appears once the rows arrive', async () => {
    // The gutter comes and goes with the row count, so a one-off measurement on
    // mount -- or a window resize listener -- leaves the header wrong for the
    // rest of the session.
    geometry.border = 300;
    geometry.content = 300;
    const wrapper = render();
    expect(await headerPadding(wrapper)).toContain('0px');

    geometry.content = 285;
    for (const fire of observerCallbacks) fire();
    await flushFrame();

    expect(await headerPadding(wrapper)).toContain('15px');
  });

  test('watches the ROWS, not the window', () => {
    // A window resize does not fire when a filter narrows the list to three
    // rows, and that is exactly when the scrollbar disappears.
    render();

    expect(observerCallbacks).toHaveLength(1);
  });

  test('measures on the NEXT frame, never inside the observer callback', async () => {
    // Writing a reactive value from the callback re-renders the panel while the
    // browser is still delivering resize notifications, which the browser
    // reports as an unhandled "ResizeObserver loop completed with undelivered
    // notifications". That reached error tracking from real sessions the night
    // the panel shipped.
    geometry.border = 300;
    geometry.content = 300;
    const wrapper = render();

    geometry.content = 285;
    for (const fire of observerCallbacks) fire();
    await nextTick();

    expect(await headerPadding(wrapper)).toContain('0px');
    expect(frames).toHaveLength(1);
  });

  test('coalesces a burst of resizes into one measurement', async () => {
    // A drag of the sidebar divider fires the observer many times per frame.
    render();

    for (let i = 0; i < 5; i++) for (const fire of observerCallbacks) fire();

    expect(frames).toHaveLength(1);
  });

  test('is ready to measure again after the frame it scheduled has run', async () => {
    // The coalescing flag has to be cleared, or the panel measures once and
    // then never again for the life of the page.
    geometry.border = 300;
    geometry.content = 300;
    const wrapper = render();

    for (const fire of observerCallbacks) fire();
    await flushFrame();

    geometry.content = 285;
    for (const fire of observerCallbacks) fire();
    await flushFrame();

    expect(await headerPadding(wrapper)).toContain('15px');
  });
});

describe('tearing down', () => {
  test('stops observing, so a removed panel is not measured forever', () => {
    const wrapper = render();

    wrapper.unmount();

    expect(disconnect).toHaveBeenCalled();
  });

  test('drops a frame it had already scheduled', () => {
    // Otherwise the callback runs against an unmounted component.
    const wrapper = render();
    for (const fire of observerCallbacks) fire();

    wrapper.unmount();

    expect(frames).toHaveLength(0);
  });
});

describe('the card', () => {
  test('is a bordered card in the sidebar', () => {
    const card = render().find('ul');

    expect(card.classes()).toContain('rounded-lg');
    expect(card.classes()).toContain('border');
  });

  test('is edge-to-edge in the mobile drawer, whose own chrome is the frame', () => {
    // A rounded, bordered card inside a full-width drawer reads as a second
    // frame drawn inside the first.
    const card = render({ flush: true }).find('ul');

    expect(card.classes()).toContain('rounded-none');
    expect(card.classes()).not.toContain('rounded-lg');
  });

  test('lets only the rows scroll, so the header and search stay put', () => {
    const wrapper = render();

    expect(scrollRegion(wrapper).exists()).toBe(true);
    expect(wrapper.find('ul').classes()).toContain('overflow-hidden');
  });

  test('caps its height rather than filling, so a short list stays short', () => {
    // Growing to fill stretched an empty card down the side of a ten-title
    // search.
    expect(scrollRegion(render()).classes()).toContain('min-h-0');
  });
});

describe('the optional parts', () => {
  test('the sort controls sit ABOVE the card, being a separate action', () => {
    const wrapper = render({}, { before: '<button>Sort</button>' });

    expect(wrapper.find('ul').text()).not.toContain('Sort');
    expect(wrapper.text()).toContain('Sort');
  });

  test('the title search sits INSIDE the card, being part of the list', () => {
    const wrapper = render({}, { subheader: '<input placeholder="Filter titles" />' });

    expect(wrapper.find('ul').find('input').exists()).toBe(true);
  });

  test('a panel with no header draws no rule where the header would have been', () => {
    // The rules exist to bound the header row; without one they are two lines
    // across an empty card.
    const bare = mount(FilterPanelShell, { slots: { default: '<li>a row</li>' } });

    expect(bare.findAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  test('a panel with a header is bounded above and below it', () => {
    // Matching the inset rules between the rows themselves.
    expect(render().findAll('[aria-hidden="true"]')).toHaveLength(2);
  });
});
