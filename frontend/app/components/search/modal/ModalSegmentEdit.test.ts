// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * The segment edit modal, and specifically its REVISION HISTORY.
 *
 * The modal is reused: it stays mounted and its `segment` prop changes as the
 * moderator moves between sentences. The history panel is open by default, so
 * every one of those moves starts a revisions request while the previous one may
 * still be out -- and a revision here is not a read-only detail. Selecting one
 * loads its text into the FORM, and the form is what gets saved. A list
 * belonging to the previous sentence is therefore a route to writing one
 * sentence's text onto another.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const listSegmentRevisions = vi.fn();
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useNadeshikoSdk', () => ({ listSegmentRevisions, updateSegment: vi.fn(), deleteEpisode: vi.fn() }));
vi.stubGlobal('useToastError', vi.fn());
vi.stubGlobal('useToastSuccess', vi.fn());
vi.stubGlobal('userStore', () => ({ isAdmin: true, user: { id: 'u1' } }));
vi.stubGlobal('useFormat', () => ({ formatDate: (d: unknown) => String(d) }));

import ModalSegmentEdit from './ModalSegmentEdit.vue';

function result(publicId: string) {
  return {
    segment: {
      publicId,
      status: 'ACTIVE',
      textJa: { content: `text-${publicId}` },
      textEn: { content: '' },
      textEs: { content: '' },
      ratingAnalysis: null,
      hashedId: 'h',
      storage: null,
      storageBasePath: null,
      episode: 1,
    },
    media: { publicId: 'm1' },
  };
}

const revision = (n: number, tag: string) => ({
  snapshotNumber: n,
  contentJa: `ja-${tag}`,
  createdAt: '2026-01-01T00:00:00Z',
  editor: { name: tag },
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mounted: { unmount: () => void }[] = [];

/** Renders the revision list flat, so a stale one is visible in the text. */
const RevisionsStub = {
  props: ['revisions', 'isLoading', 'activeSnapshotNumber'],
  template: `<div data-testid="revisions"><span v-for="r in revisions" :key="r.snapshotNumber"
    class="rev">{{ r.contentJa }}</span></div>`,
};

async function render(segment: ReturnType<typeof result> | null = null) {
  const wrapper = mount(ModalSegmentEdit, {
    props: { segment: segment as never },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: {
        CommonBaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        SearchModalSegmentEditRevisions: RevisionsStub,
        UiBaseIcon: true,
        NuxtLink: true,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const revisionsShown = (w: ReturnType<typeof mount>) => w.findAll('.rev').map((n) => n.text());

beforeEach(() => {
  vi.clearAllMocks();
  listSegmentRevisions.mockResolvedValue({ revisions: [] });
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the revision history', () => {
  test('loads for the sentence being edited', async () => {
    listSegmentRevisions.mockResolvedValue({ revisions: [revision(1, 'a')] });
    const wrapper = await render();

    await wrapper.setProps({ segment: result('seg-a') as never });
    await flushPromises();

    expect(listSegmentRevisions).toHaveBeenCalledWith('seg-a');
    expect(revisionsShown(wrapper)).toEqual(['ja-a']);
  });

  test('reloads when the moderator moves to another sentence', async () => {
    const wrapper = await render(result('seg-a'));
    listSegmentRevisions.mockResolvedValue({ revisions: [revision(1, 'b')] });

    await wrapper.setProps({ segment: result('seg-b') as never });
    await flushPromises();

    expect(listSegmentRevisions).toHaveBeenLastCalledWith('seg-b');
    expect(revisionsShown(wrapper)).toEqual(['ja-b']);
  });

  test('a reply for the PREVIOUS sentence never lands on the current one', async () => {
    // The modal stays mounted and the panel is open by default, so moving
    // between sentences routinely leaves two requests out at once. A revision
    // list belonging to the previous sentence is not a cosmetic fault: choosing
    // one of its entries loads that text into the form that gets saved.
    const wrapper = await render();
    const first = deferred<{ revisions: unknown[] }>();
    const second = deferred<{ revisions: unknown[] }>();
    listSegmentRevisions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await wrapper.setProps({ segment: result('seg-a') as never });
    await nextTick();
    await wrapper.setProps({ segment: result('seg-b') as never });
    await nextTick();

    second.resolve({ revisions: [revision(1, 'b')] });
    await flushPromises();
    first.resolve({ revisions: [revision(9, 'a'), revision(8, 'a2')] });
    await flushPromises();

    expect(revisionsShown(wrapper)).toEqual(['ja-b']);
  });

  test('a FAILED reply for a sentence already left does not empty the current list', async () => {
    // The catch clears the list, which is right for the sentence that failed and
    // wrong for the one now on screen.
    const wrapper = await render();
    const first = deferred<{ revisions: unknown[] }>();
    const second = deferred<{ revisions: unknown[] }>();
    listSegmentRevisions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await wrapper.setProps({ segment: result('seg-a') as never });
    await nextTick();
    await wrapper.setProps({ segment: result('seg-b') as never });
    await nextTick();

    second.resolve({ revisions: [revision(1, 'b')] });
    await flushPromises();
    first.reject(new Error('gone'));
    await flushPromises();

    expect(revisionsShown(wrapper)).toEqual(['ja-b']);
  });

  test('a failure is recorded without a toast, since the panel says so itself', async () => {
    listSegmentRevisions.mockRejectedValue(new Error('down'));
    const wrapper = await render();

    await wrapper.setProps({ segment: result('seg-a') as never });
    await flushPromises();

    expect(handleApiError).toHaveBeenCalledWith('modalSegmentEdit.fetchRevisions', expect.anything(), {
      toastKey: false,
    });
    expect(revisionsShown(wrapper)).toEqual([]);
  });
});
