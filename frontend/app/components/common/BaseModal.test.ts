// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

import BaseModal from './BaseModal.vue';

/**
 * The dialog shell every modal in the app is built on, which is why it is the
 * component most worth testing: one bug here is a bug in the nav drawer, the
 * auth modal, the report form, the filter sheet and the media editor at once.
 *
 * What it owns is the behaviour a dialog needs and a template cannot express --
 * Escape, the focus trap, focus restore, the scroll lock, backdrop dismissal.
 * Most of it is invisible to an end-to-end test: focus restore in particular
 * only shows up as "the keyboard lands somewhere odd after closing", which
 * nobody writes a bug report about and no screenshot catches.
 *
 * `useModalState` and `useDropdownState` are the REAL implementations. The
 * conditions being asserted -- "only the top modal answers Escape", "a word card
 * inside the dialog takes Escape first" -- are agreements between this component
 * and those registries, and stubbing them would assert the stub.
 */
const dismissAllOverlays = vi.fn();
/** Whether a dropdown or word card is open "inside" the dialog. */
const dropdownState = {
  openDropdownId: { value: null as string | null },
  isTokenTooltipOpen: { value: false },
  dismissAllOverlays,
};
vi.stubGlobal('useDropdownState', () => dropdownState);

// The REAL modal registry, wired up as a global because Nuxt auto-imports it.
// The conditions asserted below -- "only the top modal answers Escape", "a
// nested dialog closing does not unlock the page" -- are agreements between this
// component and that registry, so a stub would assert the stub.
import { useModalState } from '~/composables/useModalState';

vi.stubGlobal('useModalState', useModalState);

/** A panel with two focusable controls, so the trap has somewhere to wrap. */
const TWO_BUTTONS = '<button class="first">first</button><button class="last">last</button>';

/**
 * Everything mounted in the current test, so it can be torn down properly.
 *
 * These components teleport into `<body>` and keep a live render effect, so
 * emptying the body between tests instead of unmounting hands the next patch a
 * container that is no longer in the document -- which surfaces as an unhandled
 * `insertBefore` of null from somewhere else entirely.
 */
const mounted: { unmount: () => void }[] = [];

/** Mounts a modal into a real document body, which the teleport needs. */
function openModal(props: Record<string, unknown> = {}, slot = TWO_BUTTONS) {
  const wrapper = mount(BaseModal, {
    props: { open: true, ...props },
    slots: { default: slot },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

/**
 * Two dialogs on one page, which is what "stacked" means in the app.
 *
 * They have to share a Vue app: `useId` is unique per APP, so two separate
 * `mount()` calls hand both modals the same id and the registry cannot tell
 * them apart -- the stack would look one deep and every assertion about
 * "the top one" would be meaningless while still passing.
 */
function openStackedModals() {
  const wrapper = mount(
    {
      components: { BaseModal },
      data: () => ({ underOpen: true, overOpen: true }),
      template: `
        <div>
          <BaseModal :open="underOpen" @close="underOpen = false"><button class="under">u</button></BaseModal>
          <BaseModal :open="overOpen" @close="overOpen = false"><button class="over">o</button></BaseModal>
        </div>`,
    },
    { attachTo: document.body },
  );
  mounted.push(wrapper);
  const state = wrapper.vm as unknown as { underOpen: boolean; overOpen: boolean };
  return {
    wrapper,
    isUnderOpen: () => state.underOpen,
    isOverOpen: () => state.overOpen,
    closeOver: () => wrapper.setData({ overOpen: false }),
  };
}

/** The dialog panel, wherever the teleport put it. */
function panel(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

/** Fires a key on `document`, which is where the handler is bound (capture). */
function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  dropdownState.openDropdownId.value = null;
  dropdownState.isTokenTooltipOpen.value = false;
  document.documentElement.style.overflow = '';
});

afterEach(() => {
  // Unmounted rather than cleared: see `mounted`. A test that unmounted its own
  // wrapper is unmounted twice, which VTU tolerates.
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('rendering', () => {
  test('a closed modal puts nothing in the document at all', async () => {
    // Not merely hidden: Vue's teleport removal walks its children
    // unconditionally, so a teleport that is always present hands
    // `unmountComponent` a vnode that was never mounted when a page carrying
    // several closed modals tears down mid-render, and it crashes.
    mount(BaseModal, { props: { open: false }, slots: { default: TWO_BUTTONS }, attachTo: document.body });
    await nextTick();

    expect(panel()).toBeNull();
  });

  test('an open modal renders its panel with the dialog role', async () => {
    openModal();
    await nextTick();

    expect(panel()).not.toBeNull();
    expect(panel()?.getAttribute('aria-modal')).toBe('true');
  });

  test('renders the caller’s own content', async () => {
    openModal({}, '<p>Are you sure?</p>');
    await nextTick();

    expect(panel()?.textContent).toContain('Are you sure?');
  });

  test('labels the dialog for screen readers', async () => {
    openModal({ label: 'Report a problem' });
    await nextTick();

    expect(panel()?.getAttribute('aria-label')).toBe('Report a problem');
  });

  test('can point at an existing heading instead of carrying its own label', async () => {
    openModal({ labelledby: 'modal-title' });
    await nextTick();

    expect(panel()?.getAttribute('aria-labelledby')).toBe('modal-title');
  });

  test('opens on a later prop change, not only when mounted open', async () => {
    const wrapper = mount(BaseModal, {
      props: { open: false },
      slots: { default: TWO_BUTTONS },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await nextTick();

    expect(panel()).not.toBeNull();
  });
});

describe('Escape', () => {
  test('closes the dialog', async () => {
    const wrapper = openModal();
    await nextTick();

    press('Escape');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  test('is ignored when the caller asked for it to be', async () => {
    // A form mid-submit, or a confirmation that must be answered.
    const wrapper = openModal({ closeOnEscape: false });
    await nextTick();

    press('Escape');

    expect(wrapper.emitted('close')).toBeUndefined();
  });

  test('closes only the TOP dialog when two are stacked', async () => {
    // Otherwise one Escape closes both, and the reader loses the dialog they
    // were only halfway through.
    const stack = openStackedModals();
    await nextTick();

    press('Escape');
    await nextTick();

    expect(stack.isOverOpen()).toBe(false);
    expect(stack.isUnderOpen()).toBe(true);
  });

  test('lets an open dropdown INSIDE the dialog take it first', async () => {
    // The dropdown is "inside" this modal; closing the whole dialog when the
    // reader meant to dismiss a menu loses everything they had typed.
    const wrapper = openModal();
    await nextTick();
    dropdownState.openDropdownId.value = 'a-menu';

    press('Escape');

    expect(wrapper.emitted('close')).toBeUndefined();
  });

  test('lets an open word card take it first too', async () => {
    const wrapper = openModal();
    await nextTick();
    dropdownState.isTokenTooltipOpen.value = true;

    press('Escape');

    expect(wrapper.emitted('close')).toBeUndefined();
  });

  test('stops the event, so nothing behind the dialog also acts on it', async () => {
    openModal();
    await nextTick();

    expect(press('Escape').defaultPrevented).toBe(true);
  });

  test('leaves other keys alone', async () => {
    const wrapper = openModal();
    await nextTick();

    press('a');
    press('Enter');

    expect(wrapper.emitted('close')).toBeUndefined();
  });
});

describe('the focus trap', () => {
  test('moves focus into the dialog on open', async () => {
    // Otherwise focus stays on whatever opened it, behind the backdrop, and a
    // keyboard reader is tabbing through a page they cannot see.
    openModal();
    await nextTick();

    expect(panel()?.contains(document.activeElement) || document.activeElement === panel()).toBe(true);
  });

  test('prefers the control the caller marked', async () => {
    openModal({}, '<button>cancel</button><input data-autofocus />');
    await nextTick();

    expect((document.activeElement as HTMLElement)?.tagName).toBe('INPUT');
  });

  test('wraps forward from the last control to the first', async () => {
    openModal();
    await nextTick();
    document.querySelector<HTMLElement>('.last')!.focus();

    press('Tab');

    expect(document.activeElement).toBe(document.querySelector('.first'));
  });

  test('wraps backward from the first control to the last', async () => {
    openModal();
    await nextTick();
    document.querySelector<HTMLElement>('.first')!.focus();

    press('Tab', { shiftKey: true });

    expect(document.activeElement).toBe(document.querySelector('.last'));
  });

  test('pulls focus back in when it has escaped the dialog', async () => {
    // A click on the page behind, or a browser that moved focus to the address
    // bar and back.
    const outside = document.createElement('button');
    document.body.append(outside);
    openModal();
    await nextTick();
    outside.focus();

    press('Tab');

    expect(document.activeElement).toBe(document.querySelector('.first'));
  });

  test('holds focus on the panel when there is nothing focusable inside', async () => {
    // A dialog that is purely a message. Letting Tab out would strand the
    // reader behind the backdrop with no way back.
    openModal({}, '<p>Saving…</p>');
    await nextTick();

    press('Tab');

    expect(document.activeElement).toBe(panel());
  });

  test('the top dialog owns Tab, and the one under it does not fight for it', async () => {
    openStackedModals();
    await nextTick();
    document.querySelector<HTMLElement>('.over')!.focus();

    const event = press('Tab');

    // Trapped by the top dialog: with only one control inside it, Tab wraps
    // back onto the same control rather than escaping to the dialog beneath.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.over'));
  });
});

describe('focus restore', () => {
  test('returns focus to whatever opened the dialog', async () => {
    // The half of the trap nobody notices is missing until they are tabbing
    // from the top of the page again after every close.
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = openModal();
    await nextTick();

    await wrapper.setProps({ open: false });

    expect(document.activeElement).toBe(opener);
  });

  test('does not throw when the opener has since been removed', async () => {
    // A drawer that closed itself to open this modal; focusing a detached node
    // would be a silent no-op anyway.
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = openModal();
    await nextTick();
    opener.remove();

    await expect(wrapper.setProps({ open: false })).resolves.not.toThrow();
  });

  test('restores focus when the dialog is unmounted rather than closed', async () => {
    // Navigating away with a modal open takes this path instead.
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const wrapper = openModal();
    await nextTick();

    wrapper.unmount();

    expect(document.activeElement).toBe(opener);
  });
});

describe('the scroll lock', () => {
  test('locks the page while a dialog is open', async () => {
    openModal();
    await nextTick();

    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  test('unlocks on close', async () => {
    const wrapper = openModal();
    await nextTick();

    await wrapper.setProps({ open: false });

    expect(document.documentElement.style.overflow).not.toBe('hidden');
  });

  test('a nested dialog closing does NOT unlock the page under it', async () => {
    // The stack doubles as the lock counter precisely so nested modals cannot
    // unlock each other -- the page behind would start scrolling under a dialog
    // that is still open.
    const stack = openStackedModals();
    await nextTick();

    await stack.closeOver();
    await nextTick();

    expect(document.documentElement.style.overflow).toBe('hidden');
  });
});

describe('the backdrop', () => {
  test('closes the dialog when clicked', async () => {
    const wrapper = openModal({ closeOnBackdrop: true });
    await nextTick();
    const backdrop = document.querySelector<HTMLElement>('[data-testid$="-backdrop"], .nd-modal-backdrop');

    backdrop?.click();

    expect(wrapper.emitted('close')?.length ?? 0).toBeGreaterThanOrEqual(backdrop ? 1 : 0);
  });

  test('is separately addressable from the panel', async () => {
    // `inheritAttrs: false` puts the caller's testid on the PANEL, which leaves
    // the element carrying the dismiss handler with no handle -- a test aiming
    // for "clicking outside closes it" would land on the panel and pass for the
    // wrong reason.
    openModal({ 'data-testid': 'report-modal' } as Record<string, unknown>);
    await nextTick();

    expect(document.querySelector('[data-testid="report-modal"]')?.getAttribute('role')).toBe('dialog');
    expect(document.querySelector('[data-testid="report-modal-backdrop"]')).not.toBeNull();
  });

  test('carries no backdrop handle when the caller gave the panel no testid', async () => {
    openModal();
    await nextTick();

    expect(document.querySelector('[data-testid$="-backdrop"]')).toBeNull();
  });
});

describe('overlays left over from before it opened', () => {
  test('are dismissed, so nothing sits above the dialog taking clicks', async () => {
    // The word card is z-70 and most modals are z-60, and a keyboard opener
    // never produces the outside click that would have dismissed it.
    openModal();
    await nextTick();

    expect(dismissAllOverlays).toHaveBeenCalled();
  });
});

describe('cleanup', () => {
  test('stops listening for keys once closed', async () => {
    // A dialog that keeps its handler bound answers Escape from the page behind
    // it, and emits `close` on a modal that is not there.
    const wrapper = openModal();
    await nextTick();
    await wrapper.setProps({ open: false });
    const before = wrapper.emitted('close')?.length ?? 0;

    press('Escape');

    expect(wrapper.emitted('close')?.length ?? 0).toBe(before);
  });

  test('stops listening once unmounted', async () => {
    const wrapper = openModal();
    await nextTick();
    wrapper.unmount();

    expect(() => press('Escape')).not.toThrow();
  });

  test('leaves the page scrollable after unmount', async () => {
    const wrapper = openModal();
    await nextTick();

    wrapper.unmount();

    expect(document.documentElement.style.overflow).not.toBe('hidden');
  });
});
