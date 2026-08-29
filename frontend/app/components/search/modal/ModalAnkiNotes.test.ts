// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';

/**
 * The "pick which Anki note to write to" modal.
 *
 * It searches Anki on EVERY KEYSTROKE -- no debounce -- so several lookups are
 * routinely in flight against the reader's own machine at once. Anki answers
 * them in whatever order it finishes, which is the one thing this list cannot
 * survive: the note the reader picks is the note their sentence is written into,
 * so a list belonging to an earlier query is not a cosmetic fault.
 */
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const getNotesWithCurrentKey = vi.fn();
const activeProfile = ref<Record<string, unknown> | null>({ key: 'Expression', deck: 'Mining' });
vi.stubGlobal('ankiStore', () => ({
  get activeProfile() {
    return activeProfile.value;
  },
  getNotesWithCurrentKey,
}));

import ModalAnkiNotes from './ModalAnkiNotes.vue';

function sentence(highlight = '<em>食べる</em>を見た') {
  return { segment: { textJa: { highlight, content: '食べるを見た' } } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const notes = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ noteId: i + 1, value: `${prefix}-${i}` }));

const mounted: { unmount: () => void }[] = [];
const onClick = vi.fn();

async function render(props: Record<string, unknown> = {}) {
  const wrapper = mount(ModalAnkiNotes, {
    props: { sentence: null, onClick, ...props },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        // BaseModal has its own tests, and left real it raises a `close` of its
        // own alongside the one under test here.
        CommonBaseModal: { template: '<div><slot /></div>' },
        // `emits` is load-bearing: without it Vue binds the parent's `@click`
        // as a NATIVE listener as well, so one press runs the handler twice.
        UiButtonPrimaryAction: {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>',
        },
        UiBaseIcon: true,
      },
    },
  });
  mounted.push(wrapper);
  await nextTick();
  return wrapper;
}

async function flush() {
  for (let i = 0; i < 6; i++) await nextTick();
}

const rows = (w: ReturnType<typeof mount>) => w.findAll('tbody tr').map((r) => r.text());

beforeEach(() => {
  vi.clearAllMocks();
  activeProfile.value = { key: 'Expression', deck: 'Mining' };
  getNotesWithCurrentKey.mockResolvedValue([]);
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('seeding from the sentence', () => {
  test('searches for the word the sentence was found by', async () => {
    // The highlight is the matched term wrapped in <em>, and it is the only
    // thing here that knows which word the reader is mining.
    const wrapper = await render();
    getNotesWithCurrentKey.mockResolvedValue(notes(1, 'a'));

    await wrapper.setProps({ sentence: sentence() as never });
    await flush();

    expect(getNotesWithCurrentKey).toHaveBeenCalledWith('"deck:Mining" Expression:*食べる*');
  });

  test('a sentence with no highlight still searches, rather than doing nothing', async () => {
    const wrapper = await render();

    await wrapper.setProps({ sentence: sentence('no highlight here') as never });
    await flush();

    expect(getNotesWithCurrentKey).toHaveBeenCalled();
  });

  test('a profile with no deck searches the whole collection', async () => {
    activeProfile.value = { key: 'Expression' };
    const wrapper = await render();

    await wrapper.setProps({ sentence: sentence() as never });
    await flush();

    expect(getNotesWithCurrentKey).toHaveBeenCalledWith(' Expression:*食べる*');
  });
});

describe('without a key field configured', () => {
  test('does not search at all, because there is nothing to search on', async () => {
    activeProfile.value = { deck: 'Mining' };
    const wrapper = await render();

    await wrapper.setProps({ sentence: sentence() as never });
    await flush();

    expect(getNotesWithCurrentKey).not.toHaveBeenCalled();
  });

  test('a key field that is only whitespace counts as none', async () => {
    activeProfile.value = { key: '   ', deck: 'Mining' };
    const wrapper = await render();

    await wrapper.setProps({ sentence: sentence() as never });
    await flush();

    expect(getNotesWithCurrentKey).not.toHaveBeenCalled();
  });

  test('clears the list when the key field is taken away', async () => {
    // Otherwise the reader is left with a pickable list that can no longer be
    // matched to anything.
    getNotesWithCurrentKey.mockResolvedValue(notes(2, 'a'));
    const wrapper = await render({ sentence: sentence() });
    await wrapper.setProps({ sentence: sentence('<em>飲む</em>') as never });
    await flush();
    expect(rows(wrapper)).toHaveLength(2);

    activeProfile.value = { deck: 'Mining' };
    await flush();

    expect(rows(wrapper)).toHaveLength(0);
  });

  test('picking a note does nothing without one', async () => {
    getNotesWithCurrentKey.mockResolvedValue(notes(1, 'a'));
    const wrapper = await render({ sentence: sentence() });
    await wrapper.setProps({ sentence: sentence('<em>飲む</em>') as never });
    await flush();
    activeProfile.value = { deck: 'Mining' };
    await flush();

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('typing in the box', () => {
  test('searches for what was typed', async () => {
    const wrapper = await render({ sentence: sentence() });

    await wrapper.find('input').setValue('飲');
    await flush();

    expect(getNotesWithCurrentKey).toHaveBeenLastCalledWith('"deck:Mining" Expression:*飲*');
  });

  test('a reply for an ABANDONED keystroke never replaces the current list', async () => {
    // There is no debounce here: every keystroke is its own lookup against the
    // reader's own machine, so two are in flight for most of a word. Assigned in
    // arrival order, the list under the box belongs to whichever query Anki
    // happened to answer last -- and the note the reader then picks is the note
    // their sentence gets written into.
    const wrapper = await render({ sentence: sentence() });
    const slow = deferred<ReturnType<typeof notes>>();
    const fast = deferred<ReturnType<typeof notes>>();
    getNotesWithCurrentKey.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    await wrapper.find('input').setValue('食');
    await wrapper.find('input').setValue('食べ');

    fast.resolve(notes(1, 'tabe'));
    await flush();
    slow.resolve(notes(5, 'ta'));
    await flush();

    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0]).toContain('tabe-0');
  });

  test('a lookup in flight cannot refill the list after the key field is taken away', async () => {
    // Clearing the list is not enough on its own: the search already on its way
    // back would land afterwards and hand the reader a pickable list that can no
    // longer be matched to any field.
    const wrapper = await render({ sentence: sentence() });
    const slow = deferred<ReturnType<typeof notes>>();
    getNotesWithCurrentKey.mockReturnValueOnce(slow.promise);

    await wrapper.find('input').setValue('食');
    activeProfile.value = { deck: 'Mining' };
    await flush();

    slow.resolve(notes(3, 'stale'));
    await flush();

    expect(rows(wrapper)).toHaveLength(0);
  });
});

describe('picking a note', () => {
  test('hands the sentence and the note back, and closes', async () => {
    getNotesWithCurrentKey.mockResolvedValue(notes(1, 'a'));
    const target = sentence();
    const wrapper = await render();
    await wrapper.setProps({ sentence: target as never });
    await flush();

    await wrapper.find('tbody tr button').trigger('click');

    expect(onClick).toHaveBeenCalledExactlyOnceWith(target, 1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
