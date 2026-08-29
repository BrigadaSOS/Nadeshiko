// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';

/**
 * The reader's collections on the settings page: create, rename, re-share,
 * delete.
 *
 * Every write here edits the list IN PLACE rather than refetching, so the row on
 * screen and the row on the server are two separate facts that have to be kept
 * agreeing. The failure mode is always the same shape and always quiet: the
 * table says the rename happened, or the collection is public, and the server
 * disagrees.
 *
 * The other thing pinned here is that a FAILED load does not look like an empty
 * account -- without that distinction a reader whose fetch fell over is told
 * they have no collections and invited to make their first one.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const listCollections = vi.fn();
const updateCollection = vi.fn();
const deleteCollection = vi.fn();
const createCollection = vi.fn();
const capture = vi.fn();
const toastSuccess = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
vi.stubGlobal('useNadeshikoSdk', () => ({ listCollections, updateCollection, deleteCollection, createCollection }));
vi.stubGlobal('usePostHog', () => ({ capture }));
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useEnterSubmit', () => ({}));
// A faithful-enough `useAsyncData`: run the handler, expose the result and a
// refresh that runs it again -- which is what `retryLoad` leans on.
vi.stubGlobal(
  'useAsyncData',
  async (_key: string, handler: () => Promise<unknown>, opts?: { default?: () => unknown }) => {
    const data = ref<unknown>(opts?.default?.() ?? null);
    const refresh = async () => {
      data.value = await handler();
    };
    await refresh();
    return { data, refresh };
  },
);

import CollectionsManager from './CollectionsManager.vue';

function collection(over: Record<string, unknown> = {}) {
  return {
    publicId: 'c1',
    name: 'Mining',
    visibility: 'PRIVATE',
    type: 'MANUAL',
    segmentCount: 3,
    createdAt: '2026-01-01',
    ...over,
  };
}

const mounted: { unmount: () => void }[] = [];

async function render(list: Record<string, unknown>[] | null = [collection()]) {
  if (list === null) listCollections.mockRejectedValue(new Error('down'));
  else listCollections.mockResolvedValue({ collections: list });

  // The component's setup is ASYNC -- it awaits `useAsyncData` at the top level
  // -- so it needs a Suspense boundary to render at all. Without one `mount`
  // returns a wrapper over an empty tree and every query below finds nothing.
  const Host = defineComponent({
    components: { CollectionsManager },
    template: '<Suspense><CollectionsManager /></Suspense>',
  });

  const wrapper = mount(Host, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        // `text` is a PROP here, not a slot: a slot-only stub renders an empty
        // button and every "find the item by its label" query silently misses.
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
  await flushPromises();
  return wrapper;
}

const rows = (w: ReturnType<typeof mount>) => w.findAll('[data-testid="collection-row"]');
const get = (w: ReturnType<typeof mount>, id: string) => w.get(`[data-testid="${id}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  // Implementations too, NOT just the call log: `clearAllMocks` leaves
  // `mockRejectedValue` in place, so one test's forced failure silently became
  // every later test's -- which showed up here as a row that would not update.
  updateCollection.mockResolvedValue({});
  deleteCollection.mockResolvedValue({});
  createCollection.mockResolvedValue(collection({ publicId: 'new', name: 'Fresh' }));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the list', () => {
  test('shows what the reader has', async () => {
    const wrapper = await render([collection(), collection({ publicId: 'c2', name: 'Anime' })]);

    expect(rows(wrapper)).toHaveLength(2);
    expect(wrapper.text()).toContain('Mining');
  });

  test('a FAILED load is not the same as an empty account', async () => {
    // Without this the reader whose fetch fell over is told they have no
    // collections and invited to create their first one.
    const wrapper = await render(null);

    expect(wrapper.find('[data-testid="collections-load-error"]').exists()).toBe(true);
    expect(handleApiError).toHaveBeenCalledWith('collections:list-failed', expect.anything(), expect.anything());
  });

  test('an empty account shows no error', async () => {
    const wrapper = await render([]);

    expect(wrapper.find('[data-testid="collections-load-error"]').exists()).toBe(false);
  });

  test('retrying clears the error and asks again', async () => {
    const wrapper = await render(null);
    listCollections.mockResolvedValue({ collections: [collection()] });

    await get(wrapper, 'collections-load-error').find('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="collections-load-error"]').exists()).toBe(false);
    expect(rows(wrapper)).toHaveLength(1);
  });

  test('a retry that succeeds with NOTHING shows the empty state, not the error again', async () => {
    // The table hides the error whenever there is a row to show, so a retry
    // returning rows papers over a flag that was never cleared. An account that
    // genuinely has no collections is the case that tells the two apart.
    const wrapper = await render(null);
    listCollections.mockResolvedValue({ collections: [] });

    await get(wrapper, 'collections-load-error').find('button').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="collections-load-error"]').exists()).toBe(false);
  });
});

describe('renaming', () => {
  async function openRename(wrapper: ReturnType<typeof mount>) {
    await get(wrapper, 'collection-rename-action').trigger('click');
    await nextTick();
  }

  test('updates the row it was opened from', async () => {
    const wrapper = await render([collection(), collection({ publicId: 'c2', name: 'Anime' })]);
    await openRename(wrapper);

    await wrapper.find('input').setValue('Renamed');
    await get(wrapper, 'collection-rename-submit').trigger('click');
    await flushPromises();

    expect(updateCollection).toHaveBeenCalledWith({ collectionPublicId: 'c1', name: 'Renamed' });
    expect(rows(wrapper)[0]!.text()).toContain('Renamed');
    expect(rows(wrapper)[1]!.text()).toContain('Anime');
  });

  test('trims what the reader typed', async () => {
    const wrapper = await render();
    await openRename(wrapper);

    await wrapper.find('input').setValue('  Spaced  ');
    await get(wrapper, 'collection-rename-submit').trigger('click');
    await flushPromises();

    expect(updateCollection).toHaveBeenCalledWith({ collectionPublicId: 'c1', name: 'Spaced' });
  });

  test('a blank name cannot be submitted at all', async () => {
    // Guarded on the BUTTON as well as in the handler, and it is the button the
    // reader meets: the disabled state is what says "this will not do anything"
    // before they press it.
    const wrapper = await render();
    await openRename(wrapper);

    await wrapper.find('input').setValue('   ');
    await nextTick();

    expect(get(wrapper, 'collection-rename-submit').attributes('disabled')).toBeDefined();
    await get(wrapper, 'collection-rename-submit').trigger('click');
    await flushPromises();
    expect(updateCollection).not.toHaveBeenCalled();
  });

  test('a FAILED rename leaves the modal open, with the typing still in it', async () => {
    // There is nothing to go back to and nothing was changed; closing would
    // make the reader find the collection and type the name again.
    const wrapper = await render();
    updateCollection.mockRejectedValue(new Error('down'));
    await openRename(wrapper);

    await wrapper.find('input').setValue('Renamed');
    await get(wrapper, 'collection-rename-submit').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="collection-rename-submit"]').exists()).toBe(true);
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('Renamed');
    expect(rows(wrapper)[0]!.text()).toContain('Mining');
  });
});

describe('changing who can see one', () => {
  /** Opens the confirmation for the row's visibility item. */
  async function openVisibility(wrapper: ReturnType<typeof mount>, label: string) {
    const item = wrapper.findAll('button').find((b) => b.text().trim() === label);
    if (!item) throw new Error(`no visibility item labelled ${label}`);
    await item.trigger('click');
    await nextTick();
  }

  async function confirm(wrapper: ReturnType<typeof mount>) {
    const button = wrapper
      .findAll('button')
      .find((b) => b.text().trim() === 'accountSettings.collections.visibilityConfirm');
    if (!button) throw new Error('the visibility confirmation is not open');
    await button.trigger('click');
    await flushPromises();
  }

  test('makes a private collection public, and says so in the row', async () => {
    const wrapper = await render();

    await openVisibility(wrapper, 'accountSettings.collections.makePublic');
    await confirm(wrapper);

    expect(updateCollection).toHaveBeenCalledWith({ collectionPublicId: 'c1', visibility: 'PUBLIC' });
    expect(rows(wrapper)[0]!.text()).toContain('accountSettings.collections.visibility.PUBLIC');
  });

  test('and takes a public one back to private', async () => {
    const wrapper = await render([collection({ visibility: 'PUBLIC' })]);

    await openVisibility(wrapper, 'accountSettings.collections.makePrivate');
    await confirm(wrapper);

    expect(updateCollection).toHaveBeenCalledWith({ collectionPublicId: 'c1', visibility: 'PRIVATE' });
    expect(rows(wrapper)[0]!.text()).toContain('accountSettings.collections.visibility.PRIVATE');
  });

  test('a FAILED change leaves the row saying what is actually true', async () => {
    // The row is edited in place rather than refetched, so a write that did not
    // land must not be shown as though it had -- a collection the reader
    // believes is private is the one mistake here that matters.
    const wrapper = await render();
    updateCollection.mockRejectedValue(new Error('down'));

    await openVisibility(wrapper, 'accountSettings.collections.makePublic');
    await confirm(wrapper);

    expect(rows(wrapper)[0]!.text()).toContain('accountSettings.collections.visibility.PRIVATE');
    expect(handleApiError).toHaveBeenCalledWith(
      'collections:visibility-update-failed',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('deleting', () => {
  test('removes only the collection it was opened from', async () => {
    const wrapper = await render([collection(), collection({ publicId: 'c2', name: 'Anime' })]);

    await wrapper.findAll('[data-testid="collection-delete-action"]')[0]!.trigger('click');
    await nextTick();
    await get(wrapper, 'collection-delete-submit').trigger('click');
    await flushPromises();

    expect(deleteCollection).toHaveBeenCalledWith('c1');
    expect(rows(wrapper)).toHaveLength(1);
    expect(rows(wrapper)[0]!.text()).toContain('Anime');
  });

  test('a FAILED delete keeps the row, rather than pretending it went', async () => {
    const wrapper = await render();
    deleteCollection.mockRejectedValue(new Error('down'));

    await get(wrapper, 'collection-delete-action').trigger('click');
    await nextTick();
    await get(wrapper, 'collection-delete-submit').trigger('click');
    await flushPromises();

    expect(rows(wrapper)).toHaveLength(1);
    expect(handleApiError).toHaveBeenCalledWith('collections:delete-failed', expect.anything(), expect.anything());
  });

  test('an Anki export cannot be deleted from here at all', async () => {
    // It is written by the exporter, not by the reader, and deleting it would
    // come straight back.
    const wrapper = await render([collection({ type: 'ANKI_EXPORT' })]);

    expect(wrapper.find('[data-testid="collection-delete-action"]').exists()).toBe(false);
  });
});

describe('creating', () => {
  test('puts the new collection at the top of the list', async () => {
    const wrapper = await render([collection()]);
    createCollection.mockResolvedValue(collection({ publicId: 'new', name: 'Fresh' }));

    await get(wrapper, 'create-collection-button').trigger('click');
    await nextTick();
    await wrapper.find('input').setValue('Fresh');
    await get(wrapper, 'collection-create-submit').trigger('click');
    await flushPromises();

    expect(createCollection).toHaveBeenCalledWith({ name: 'Fresh' });
    expect(rows(wrapper)[0]!.text()).toContain('Fresh');
  });

  test('a FAILED create leaves the modal open to retry', async () => {
    const wrapper = await render([]);
    createCollection.mockRejectedValue(new Error('down'));

    await get(wrapper, 'create-collection-button').trigger('click');
    await nextTick();
    await wrapper.find('input').setValue('Fresh');
    await get(wrapper, 'collection-create-submit').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="collection-create-submit"]').exists()).toBe(true);
    expect(rows(wrapper)).toHaveLength(0);
  });
});
