// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The `?` shortcuts sheet.
 *
 * Its listener is on `window` in the CAPTURE phase, so it sees every key pressed
 * anywhere on the page -- including inside the search box, where `?` is a
 * character a reader is typing and not a request for help. Opening the sheet
 * over their half-written query is the failure this guards.
 *
 * Both spellings have to work: `?` arrives as a key on most layouts, but on
 * layouts where it needs Shift the browser may report the physical `Slash` with
 * a shift modifier instead.
 */
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));

import ModalKeyboardShortcuts from './ModalKeyboardShortcuts.vue';

const mounted: { unmount: () => void }[] = [];

function render() {
  const wrapper = mount(ModalKeyboardShortcuts, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open" data-testid="shortcuts-modal"><slot /></div>' },
        UiBaseIcon: true,
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const isOpen = (w: ReturnType<typeof render>) => w.find('[data-testid="shortcuts-modal"]').exists();

/** A key as the window capture listener sees it. */
async function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  await nextTick();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

describe('opening the sheet', () => {
  test('starts shut', () => {
    expect(isOpen(render())).toBe(false);
  });

  test('`?` opens it', async () => {
    const wrapper = render();

    await press({ key: '?' });

    expect(isOpen(wrapper)).toBe(true);
  });

  test('and Shift+Slash does too, for layouts that report the physical key', async () => {
    const wrapper = render();

    await press({ key: '/', code: 'Slash', shiftKey: true });

    expect(isOpen(wrapper)).toBe(true);
  });

  test('pressing it again closes the sheet', async () => {
    const wrapper = render();

    await press({ key: '?' });
    await press({ key: '?' });

    expect(isOpen(wrapper)).toBe(false);
  });

  test('another key does nothing', async () => {
    const wrapper = render();

    await press({ key: 'a' });

    expect(isOpen(wrapper)).toBe(false);
  });
});

describe('while the reader is typing', () => {
  test('`?` in a text field is a CHARACTER, not a request for help', async () => {
    // The listener is on `window`: every keystroke of the search box arrives
    // here, and the sheet would open over a half-written query.
    const wrapper = render();
    const input = document.createElement('input');
    document.body.appendChild(input);

    await press({ key: '?' }, input);

    expect(isOpen(wrapper)).toBe(false);
  });

  test('nor in a textarea', async () => {
    const wrapper = render();
    const area = document.createElement('textarea');
    document.body.appendChild(area);

    await press({ key: '?' }, area);

    expect(isOpen(wrapper)).toBe(false);
  });

  test('nor in a select', async () => {
    const wrapper = render();
    const select = document.createElement('select');
    document.body.appendChild(select);

    await press({ key: '?' }, select);

    expect(isOpen(wrapper)).toBe(false);
  });

  test('nor in anything contenteditable', async () => {
    const wrapper = render();
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.appendChild(editable);

    await press({ key: '?' }, editable);

    expect(isOpen(wrapper)).toBe(false);
  });
});

describe('opening it from elsewhere', () => {
  test('the exposed `open` works without a keystroke', async () => {
    // The header's help link uses this rather than synthesising a key event.
    const wrapper = render();

    (wrapper.vm as unknown as { open: () => void }).open();
    await nextTick();

    expect(isOpen(wrapper)).toBe(true);
  });
});

describe('teardown', () => {
  test('unmounting REMOVES the listener rather than leaking one per mount', async () => {
    // Asserted on the registration, not on behaviour: after unmount nothing
    // renders either way, so a leaked listener is invisible from the outside --
    // and this component mounts once per route, so the leak compounds.
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');

    const wrapper = render();
    const registered = added.mock.calls.filter(([type]) => String(type) === 'keydown');
    expect(registered).toHaveLength(1);

    wrapper.unmount();
    mounted.splice(mounted.indexOf(wrapper), 1);

    const unregistered = removed.mock.calls.filter(([type]) => String(type) === 'keydown');
    expect(unregistered).toHaveLength(1);
    // The same handler and the same capture flag, or the removal is a no-op.
    expect(unregistered[0]![1]).toBe(registered[0]![1]);
    expect(unregistered[0]![2]).toBe(registered[0]![2]);

    added.mockRestore();
    removed.mockRestore();
  });
});
