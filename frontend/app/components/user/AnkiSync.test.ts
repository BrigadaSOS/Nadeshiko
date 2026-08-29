// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The Anki settings page: which deck, which note type, and what goes in each
 * field.
 *
 * Everything here AUTOSAVES, which is what makes the failure modes quiet. There
 * is no Save button to fail, so a write that silently does the wrong thing --
 * replacing a field template instead of adding to it, or persisting an empty
 * mapping because Anki stopped answering -- is discovered by the reader later,
 * on a card that came out wrong.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const updateActiveProfile = vi.fn();
const loadAnkiData = vi.fn();
const getAllModelFieldNames = vi.fn();
const activeProfile = ref<Record<string, unknown> | null>(null);
const connectFailure = ref<string | null>(null);

const store = {
  get activeProfile() {
    return activeProfile.value;
  },
  get connectFailure() {
    return connectFailure.value;
  },
  // Non-empty: the profile card (and the save-status line inside it) is
  // `v-if="profiles.length > 0"`, and `onMounted` creates one when it is empty.
  profiles: [{ id: 'p1', name: 'Default' }] as unknown[],
  availableDecks: ['Mining', 'Default'],
  availableModels: ['Lapis', 'Basic'],
  updateActiveProfile,
  loadAnkiData,
  getAllModelFieldNames,
  setActiveProfile: vi.fn(),
  createProfile: vi.fn(),
  // Called from `onMounted` before anything else; a store without them throws
  // there and the form is never seeded from the profile at all.
  migrateFromLocalStorage: vi.fn().mockResolvedValue(undefined),
  mostCommonModelInDeck: vi.fn().mockResolvedValue(null),
  renameProfile: vi.fn(),
  deleteProfile: vi.fn(),
};

vi.stubGlobal('ankiStore', () => store);
vi.stubGlobal('userStore', () => ({ isLoggedIn: true, preferences: {} }));
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useDropdownState', () => ({ closeAllDropdowns: vi.fn(), openDropdownId: ref(null) }));
vi.stubGlobal('useEnterSubmit', () => ({}));
vi.stubGlobal('copyToClipboard', vi.fn().mockResolvedValue(true));
vi.stubGlobal('useToastError', vi.fn());
vi.stubGlobal('useToastSuccess', vi.fn());
vi.stubGlobal('usePostHog', () => ({ capture: vi.fn() }));
vi.stubGlobal('useNadeshikoSdk', () => ({ getShirabeConnection: vi.fn().mockResolvedValue(null) }));

import AnkiSync from './AnkiSync.vue';

function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Default',
    deck: 'Mining',
    model: 'Lapis',
    key: 'Expression',
    fields: [{ key: 'Expression', value: '{word}' }],
    serverAddress: 'http://127.0.0.1:8765',
    openBrowserOnExport: true,
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render() {
  const wrapper = mount(AnkiSync, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: {
          props: ['text'],
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ text }}</button>',
        },
        UiBaseIcon: true,
        NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
  mounted.push(wrapper);
  // `onMounted` is async and seeds the form at the end of it.
  await vi.runOnlyPendingTimersAsync();
  await nextTick();
  return wrapper;
}

const fieldInputs = (w: Awaited<ReturnType<typeof render>>) =>
  w.findAll('[data-testid="anki-field-value"]').map((n) => (n.element as HTMLInputElement).value);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  activeProfile.value = profile();
  connectFailure.value = null;
  updateActiveProfile.mockResolvedValue({});
  loadAnkiData.mockResolvedValue(undefined);
  getAllModelFieldNames.mockResolvedValue(['Expression', 'Meaning']);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.useRealTimers();
});

describe('loading the reader’s profile into the form', () => {
  test('shows the deck, note type and field mapping they saved', async () => {
    const wrapper = await render();

    expect((wrapper.get('[data-testid="anki-deck-select"]').element as HTMLSelectElement).value).toBe('Mining');
    expect((wrapper.get('[data-testid="anki-model-select"]').element as HTMLSelectElement).value).toBe('Lapis');
    expect(fieldInputs(wrapper)).toEqual(['{word}']);
  });

  test('a profile with no server address falls back to the local default', async () => {
    activeProfile.value = profile({ serverAddress: null });
    const wrapper = await render();

    // `v-model` values are not serialised into `html()`; read the element.
    expect((wrapper.find('input.nd-input').element as HTMLInputElement).value).toBe('http://127.0.0.1:8765');
  });

  test('opening the browser on export defaults to ON, and only `false` turns it off', async () => {
    // `?? true` would leave an explicit `false` intact but a missing value on;
    // the distinction is `!== false`, and it is what a profile saved before the
    // option existed relies on.
    activeProfile.value = profile({ openBrowserOnExport: undefined });
    expect(((await render()).find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true);

    activeProfile.value = profile({ openBrowserOnExport: false });
    expect(((await render()).find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false);
  });
});

describe('the key field warning', () => {
  test('warns when no key field is chosen, because exports cannot find a card', async () => {
    activeProfile.value = profile({ key: null });
    const wrapper = await render();

    expect(wrapper.find('[data-testid="anki-key-field-warning"]').exists()).toBe(true);
  });

  test('a key field of only whitespace counts as none', async () => {
    activeProfile.value = profile({ key: '   ' });

    expect((await render()).find('[data-testid="anki-key-field-warning"]').exists()).toBe(true);
  });

  test('and none once one is chosen', async () => {
    expect((await render()).find('[data-testid="anki-key-field-warning"]').exists()).toBe(false);
  });
});

describe('autosaving', () => {
  test('waits for a pause before writing, rather than saving every keystroke', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="anki-field-value"]').setValue('{word}{reading}');
    expect(updateActiveProfile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    await nextTick();

    expect(updateActiveProfile).toHaveBeenCalledTimes(1);
  });

  test('coalesces several edits into one write', async () => {
    const wrapper = await render();

    await wrapper.get('[data-testid="anki-field-value"]').setValue('a');
    vi.advanceTimersByTime(200);
    await wrapper.get('[data-testid="anki-field-value"]').setValue('ab');
    vi.advanceTimersByTime(400);
    await nextTick();

    expect(updateActiveProfile).toHaveBeenCalledTimes(1);
  });

  test('says "saved" afterwards, and lets the message linger long enough to read', async () => {
    // A save takes about a tenth of a second, so a message tied to the request
    // faded in and out inside a blink and told the reader nothing.
    const wrapper = await render();

    await wrapper.get('[data-testid="anki-field-value"]').setValue('x');
    // Advanced exactly to the save, NOT past it: running every pending timer
    // also fires the 2.5s that clears the message, and the assertion below then
    // fails for a reason that has nothing to do with the message appearing.
    await vi.advanceTimersByTimeAsync(400);
    await nextTick();

    expect(wrapper.get('[data-testid="anki-save-status"]').text()).toBe('accountSettings.anki.saved');

    // ...and it goes away on its own, rather than claiming the next edit saved.
    await vi.advanceTimersByTimeAsync(2500);
    await nextTick();

    expect(wrapper.get('[data-testid="anki-save-status"]').text()).toBe('');
  });

  test('a FAILED autosave is toasted, because nothing else would tell them', async () => {
    // There is no Save button whose spinner could stall; silence here means the
    // field mapping was lost with no sign at all.
    updateActiveProfile.mockRejectedValue(new Error('down'));
    const wrapper = await render();

    await wrapper.get('[data-testid="anki-field-value"]').setValue('x');
    vi.advanceTimersByTime(400);
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(handleApiError).toHaveBeenCalledWith(
      'anki:profile-save-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: 'accountSettings.anki.profileSaveError' }),
    );
  });
});

describe('adding a placeholder to a field', () => {
  test('ADDS to what is already there rather than replacing it', async () => {
    // It used to replace, which made the menu a one-of-these picker and put a
    // silent ceiling on what a field could say: there was no way to build
    // `{definition:a}<br>{definition:b}` except by typing both by hand.
    const wrapper = await render();
    // The menu item shows a TRANSLATED label; the placeholder it inserts is an
    // argument to the click handler, so it never appears in the button's text.
    const item = wrapper.findAll('button').find((b) => b.text() === 'searchpage.main.buttons.jpsentence');
    if (!item) throw new Error('no placeholder menu item found');

    await item.trigger('click');
    await nextTick();

    expect(fieldInputs(wrapper)[0]).toBe('{word}<br>{sentence-jp}');
  });

  test('an empty field takes the placeholder alone, with no separator', async () => {
    activeProfile.value = profile({ fields: [{ key: 'Expression', value: '' }] });
    const wrapper = await render();
    // The menu item shows a TRANSLATED label; the placeholder it inserts is an
    // argument to the click handler, so it never appears in the button's text.
    const item = wrapper.findAll('button').find((b) => b.text() === 'searchpage.main.buttons.jpsentence');
    if (!item) throw new Error('no placeholder menu item found');

    await item.trigger('click');
    await nextTick();

    expect(fieldInputs(wrapper)[0]).toBe('{sentence-jp}');
  });
});

describe('when Anki cannot be reached', () => {
  test('shows the specific reason rather than generic advice', async () => {
    connectFailure.value = 'permission_denied';
    loadAnkiData.mockRejectedValue(Object.assign(new Error('nope'), { reason: 'permission_denied' }));
    const wrapper = await render();

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('connect'))
      ?.trigger('click');
    await vi.runOnlyPendingTimersAsync();
    await nextTick();

    expect(wrapper.text()).toContain('connectFailure.permission_denied.title');
  });
});
