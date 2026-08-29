// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';

/**
 * The dropdown every result card carries four of.
 *
 * Almost every rule in here was written to fix something that had already
 * shipped, and each one fails silently: the menu still opens, still closes, and
 * still looks right, so a regression reaches readers rather than CI. The e2e
 * suite covers the happy path at seconds per case; these cover the edges at
 * milliseconds, including the two that e2e cannot reach at all -- an item that
 * re-renders its own menu, and scrolling INSIDE a menu that closes on scroll.
 *
 * Everything here mounts through a single parent when more than one dropdown is
 * involved. `useId` counts per app instance, so two separate `mount()` calls
 * hand both containers the SAME id, they resolve to one dropdown, and every
 * "only one open at a time" assertion passes without ever having been tested.
 */
import { useDropdownState } from '~/composables/useDropdownState';

const routeState = reactive({ fullPath: '/search' });
vi.stubGlobal('useRoute', () => routeState);
// The REAL shared state, not a fake: "only one open at a time" is the thing
// under test, and a stub would be asserting against my own reimplementation.
vi.stubGlobal('useDropdownState', useDropdownState);

import DropdownContainer from './DropdownContainer.vue';

const mounted: { unmount: () => void }[] = [];

/** A dropdown with a real trigger and a menu holding a link and a plain span. */
const slots = {
  default: `<button class="trigger" @click="params.toggle()">open</button>`,
  content: `<div><a class="item" href="#">go</a><span class="inert">text</span>
    <div data-nd-keep-open><button class="sticky">stay</button></div></div>`,
};

function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(DropdownContainer, {
    props,
    slots: { default: `<template #default="params">${slots.default}</template>`, content: slots.content },
    // Teleport must be real -- a stubbed one never leaves the component, which
    // is the whole property under test. Transition stays stubbed: the real one
    // keeps a closing menu mounted for its leave animation, and every "is it
    // gone" assertion here would then be racing it.
    global: { stubs: { teleport: false } },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/** Two dropdowns in ONE app, which is the only way their ids differ. */
function renderPair() {
  const Parent = defineComponent({
    components: { DropdownContainer },
    template: `<div>
      <DropdownContainer dropdown-id="same">
        <template #default="p"><button class="trigger-a" @click="p.toggle()">a</button></template>
        <template #content><div class="menu-a">A</div></template>
      </DropdownContainer>
      <DropdownContainer dropdown-id="same">
        <template #default="p"><button class="trigger-b" @click="p.toggle()">b</button></template>
        <template #content><div class="menu-b">B</div></template>
      </DropdownContainer>
    </div>`,
  });
  const wrapper = mount(Parent, {
    global: { stubs: { teleport: false } },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/** Every menu currently in the document, teleported or not. */
const menus = () => document.querySelectorAll('[data-testid="dropdown-menu"]');

/** A real bubbling click, so `composedPath` is populated as in a browser. */
function clickOn(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

beforeEach(() => {
  routeState.fullPath = '/search';
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('rendering', () => {
  test('a CLOSED menu is not in the document at all', async () => {
    // `v-if`, not `v-show`. A word page holds 123 of these; under `v-show` the
    // unopened ones were 3,476 elements, 46% of the served document, paid on
    // every style recalculation. A regression is invisible -- the page looks
    // and behaves identically -- so the count is the only signal there is.
    render();

    expect(menus()).toHaveLength(0);
  });

  test('opens on the trigger the slot was handed', async () => {
    const wrapper = render();

    await wrapper.find('.trigger').trigger('click');

    expect(menus()).toHaveLength(1);
  });

  test('toggling again closes it', async () => {
    const wrapper = render();

    await wrapper.find('.trigger').trigger('click');
    await wrapper.find('.trigger').trigger('click');

    expect(menus()).toHaveLength(0);
  });
});

describe('only one open at a time', () => {
  test('two dropdowns on a page get different ids even with the same dropdownId', async () => {
    // Otherwise they are one dropdown wearing two triggers, and every
    // assertion below is vacuous.
    const wrapper = renderPair();

    await wrapper.find('.trigger-a').trigger('click');

    expect(document.querySelectorAll('.menu-a')).toHaveLength(1);
    expect(document.querySelectorAll('.menu-b')).toHaveLength(0);
  });

  test('opening one closes the other', async () => {
    const wrapper = renderPair();

    await wrapper.find('.trigger-a').trigger('click');
    await wrapper.find('.trigger-b').trigger('click');
    await nextTick();

    expect(document.querySelectorAll('.menu-a')).toHaveLength(0);
    expect(document.querySelectorAll('.menu-b')).toHaveLength(1);
  });
});

describe('dismissing', () => {
  test('Escape closes it', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();

    expect(menus()).toHaveLength(0);
  });

  test('another key does not', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await nextTick();

    expect(menus()).toHaveLength(1);
  });

  test('a click outside closes it', async () => {
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    clickOn(outside);
    await nextTick();

    expect(menus()).toHaveLength(0);
  });

  test('a link inside the menu dismisses it, the way a menu item should', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    clickOn(document.querySelector('.item')!);
    await nextTick();

    expect(menus()).toHaveLength(0);
  });

  test('but NOT one marked data-nd-keep-open', async () => {
    // The controls that stay put while the reader works through them.
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    clickOn(document.querySelector('.sticky')!);
    await nextTick();

    expect(menus()).toHaveLength(1);
  });

  test('and not a click on plain text inside the menu', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    clickOn(document.querySelector('.inert')!);
    await nextTick();

    expect(menus()).toHaveLength(1);
  });

  test('a click INSIDE survives the item having re-rendered the menu under it', async () => {
    // The Anki field menu bug. An item whose job is to replace the list around
    // it is unmounted before the click reaches `document` -- Vue flushes the
    // patch at the microtask checkpoint between listeners, while the event is
    // still bubbling -- so `contains` answers false for a click that was
    // unmistakably inside, and the menu dismissed itself on the way in.
    // `composedPath` is snapshotted at dispatch and still names the menu.
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');
    await nextTick();
    const menu = document.querySelector('[data-testid="dropdown-menu"]')!;
    const item = document.querySelector('.inert')!;

    // The path is supplied rather than produced, and that is a limitation of the
    // environment, not a shortcut: happy-dom recomputes `composedPath()` from
    // the node's CURRENT ancestors, so a detached item yields a path of length
    // one and the browser behaviour this fix leans on does not exist here. What
    // is asserted is the component's own branching -- given a path that names
    // the menu, a click is inside, whatever `contains` now says. The end-to-end
    // behaviour is covered in a real browser by the dropdown e2e specs.
    item.remove();
    const event = new MouseEvent('click', { bubbles: true, composed: true });
    Object.defineProperty(event, 'composedPath', {
      // `document` must be in the path: happy-dom drives propagation FROM
      // composedPath, so omitting it means the component's document-level
      // listener never runs and the test passes without testing anything --
      // which is exactly what it did until a mutation run caught it.
      value: () => [item, menu, document.body, document],
      configurable: true,
    });
    // From `body` rather than `document`: the menu's own click handler reads
    // `target.closest(...)`, and `document` is not an element.
    document.body.dispatchEvent(event);
    await nextTick();

    expect(menus()).toHaveLength(1);
  });

  test('navigating away closes it', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');

    routeState.fullPath = '/search/other';
    await nextTick();

    expect(menus()).toHaveLength(0);
  });
});

describe('a teleported menu', () => {
  test('renders on body, out of any clipping ancestor', async () => {
    const wrapper = render({ teleport: true });

    await wrapper.find('.trigger').trigger('click');
    await nextTick();

    const menu = document.querySelector('[data-testid="dropdown-menu"]')!;
    expect(document.body.contains(menu)).toBe(true);
    expect(wrapper.element.contains(menu)).toBe(false);
  });

  test('is placed as fixed, above the modals it may have been opened from', async () => {
    // Teleporting takes it out of the dialog's stacking context, where its
    // `z-50` used to just work; on `body` it landed under the modal.
    const wrapper = render({ teleport: true });

    await wrapper.find('.trigger').trigger('click');
    await nextTick();

    const style = document.querySelector<HTMLElement>('[data-testid="dropdown-menu"]')!.style;
    expect(style.position).toBe('fixed');
    expect(Number(style.zIndex)).toBeGreaterThan(80);
  });

  test('closes when the PAGE scrolls, because it no longer matches its trigger', async () => {
    const wrapper = render({ teleport: true });
    await wrapper.find('.trigger').trigger('click');
    await nextTick();

    window.dispatchEvent(new Event('scroll'));
    await nextTick();

    expect(menus()).toHaveLength(0);
  });

  test('but NOT when the reader scrolls inside the menu itself', async () => {
    // The listener is on `window` in the capture phase, so it sees a scrolling
    // menu body's own events. The reader reached for the list and the list
    // vanished; nothing had moved relative to anything.
    const wrapper = render({ teleport: true });
    await wrapper.find('.trigger').trigger('click');
    await nextTick();
    const menu = document.querySelector('[data-testid="dropdown-menu"]')!;

    const scroll = new Event('scroll', { bubbles: false });
    menu.dispatchEvent(scroll);
    await nextTick();

    expect(menus()).toHaveLength(1);
  });

  test('a NON-teleported menu ignores page scroll entirely', async () => {
    // It moves with the page, so there is nothing to correct for.
    const wrapper = render({ teleport: false });
    await wrapper.find('.trigger').trigger('click');

    window.dispatchEvent(new Event('scroll'));
    await nextTick();

    expect(menus()).toHaveLength(1);
  });
});

describe('teardown', () => {
  test('unmounting takes the menu and its listeners with it', async () => {
    const wrapper = render();
    await wrapper.find('.trigger').trigger('click');
    expect(menus()).toHaveLength(1);

    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);
    await nextTick();

    expect(menus()).toHaveLength(0);
    // And the document listeners are gone: a stray Escape must not reach a
    // component that no longer exists.
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
  });
});
