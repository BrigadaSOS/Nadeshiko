// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * The admin reports queue.
 *
 * Two things here decide what a BULK action touches, and they are not the same
 * expression. The list query drops the status filter when every status is
 * selected -- "all" and "no filter" mean the same thing to a reader. The bulk
 * query deliberately keeps it, because a bulk update with no filter at all is a
 * request to change every report in the table, and the backend refuses one. The
 * two being written separately is exactly why they can drift apart, and nothing
 * about the screen would show it: the list would look right and the bulk action
 * would touch a different set.
 *
 * Selection is by GROUP index, and the two id lists taken from it are different
 * on purpose -- a batch status update covers every report in a group, while a
 * delete takes only the group's representative.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const listAdminReports = vi.fn();
const batchUpdateAdminReports = vi.fn();
const bulkUpdateAdminReports = vi.fn();
const batchDeleteAdminReports = vi.fn();
const deleteAdminReport = vi.fn();
const updateAdminReport = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k }));
vi.stubGlobal('useFormat', () => ({ formatNumber: (n: number) => String(n), formatDate: (d: unknown) => String(d) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useToastError', toastError);
vi.stubGlobal('useNadeshikoSdk', () => ({
  listAdminReports,
  batchUpdateAdminReports,
  bulkUpdateAdminReports,
  batchDeleteAdminReports,
  deleteAdminReport,
  updateAdminReport,
}));

import { useCursorPagination } from '~/composables/useCursorPagination';
// The REAL pagination composable: its `stale` handling is part of what the
// component leans on, and a stub would be asserting against my own version.
vi.stubGlobal('useCursorPagination', useCursorPagination);

import ReportsManager from './ReportsManager.vue';

function report(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    status: 'OPEN',
    reason: 'BROKEN_AUDIO',
    adminNotes: '',
    createdAt: '2026-01-01T00:00:00Z',
    targetType: 'SEGMENT',
    segment: { publicId: `s${id}` },
    ...over,
  };
}

/** A group as the reports endpoint returns one: several reports on one target. */
function group(ids: number[]) {
  return { key: `g${ids[0]}`, reports: ids.map((id) => report(id)), segment: { publicId: `s${ids[0]}` } };
}

const mounted: { unmount: () => void }[] = [];

async function render(groups: unknown[] = [group([1, 2]), group([3])]) {
  listAdminReports.mockResolvedValue({ groups, pagination: { hasMore: false, cursor: null } });
  const wrapper = mount(ReportsManager, {
    global: {
      mocks: { $t: (k: string) => k },
      // This component is pure orchestration: the controls all live in children
      // that emit. Stubbing them to expose one button per event tests THIS
      // component's decisions rather than its children's markup, which have
      // their own concerns.
      stubs: {
        AdminReportsFilters: {
          emits: ['toggle-status'],
          template: `<div><button v-for="s in ['OPEN','PROCESSING','FIXED','DISMISSED']" :key="s"
            :data-status="s" @click="$emit('toggle-status', s)">{{ s }}</button></div>`,
        },
        AdminReportsBulkActions: {
          emits: ['dismiss-all', 'delete-all'],
          template: `<div><button data-act="dismiss-all" @click="$emit('dismiss-all')">d</button>
            <button data-act="delete-all" @click="$emit('delete-all')">x</button></div>`,
        },
        AdminReportsSelectionBar: {
          props: ['count'],
          emits: ['update', 'delete', 'clear'],
          template: `<div data-testid="selection-bar"><span data-count>{{ count }}</span>
            <button data-act="batch-fixed" @click="$emit('update', 'FIXED')">f</button>
            <button data-act="batch-delete" @click="$emit('delete')">x</button></div>`,
        },
        AdminReportsTable: {
          props: ['groups'],
          emits: ['toggle-select', 'toggle-select-all'],
          template: `<div><button data-act="select-all" @click="$emit('toggle-select-all')">a</button>
            <button v-for="(g, i) in groups" :key="i" :data-select="i"
              @click="$emit('toggle-select', i)">g</button></div>`,
        },
        CommonConfirmModal: {
          props: ['visible'],
          emits: ['confirm', 'cancel'],
          template: `<div v-if="visible"><button data-act="confirm" @click="$emit('confirm')">y</button></div>`,
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

/** The filter chip for one status. */
const statusChip = (wrapper: ReturnType<typeof mount>, status: string) => wrapper.get(`[data-status="${status}"]`);
const act = (wrapper: ReturnType<typeof mount>, name: string) => wrapper.get(`[data-act="${name}"]`);

/** The last query the list endpoint was asked for. Throws rather than returning
 *  undefined: an assertion about a query that was never made passes vacuously,
 *  which is exactly how a wrong SDK method name hid here. */
function lastListQuery() {
  const call = listAdminReports.mock.calls.at(-1);
  if (!call) throw new Error('the reports endpoint was never called');
  return call[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  batchUpdateAdminReports.mockResolvedValue({ count: 2 });
  bulkUpdateAdminReports.mockResolvedValue({ count: 9 });
  deleteAdminReport.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the status filter', () => {
  test('sends NO status filter when every status is wanted', async () => {
    // "All four" and "no filter" are the same request, and the shorter one is
    // what the endpoint is tuned for.
    await render();

    expect(lastListQuery().status).toBeUndefined();
  });

  test('sends just the ones still selected', async () => {
    const wrapper = await render();

    await statusChip(wrapper, 'DISMISSED').trigger('click');
    await flushPromises();

    expect(lastListQuery().status).toBe('OPEN,PROCESSING,FIXED');
  });

  test('deselecting everything means no filter, so the queue is not silently empty', async () => {
    // Consistent with the bulk action below, which is the point: the admin acts
    // on what they can see.
    const wrapper = await render();
    for (const status of ['OPEN', 'PROCESSING', 'FIXED', 'DISMISSED']) {
      await statusChip(wrapper, status).trigger('click');
    }
    await flushPromises();

    expect(lastListQuery().status).toBeUndefined();
  });
});

describe('bulk dismiss', () => {
  /** Opens the confirmation and presses through it. */
  async function bulkDismiss(wrapper: ReturnType<typeof mount>) {
    await act(wrapper, 'dismiss-all').trigger('click');
    await nextTick();
    await act(wrapper, 'confirm').trigger('click');
    await flushPromises();
  }

  test('KEEPS the status filter even when every status is selected', async () => {
    // The opposite of the list query, and deliberately so: a bulk update with no
    // filter is a request to change every report there is.
    const wrapper = await render();

    await bulkDismiss(wrapper);

    expect(bulkUpdateAdminReports).toHaveBeenCalledWith({
      status: 'DISMISSED',
      filters: { status: 'OPEN,PROCESSING,FIXED,DISMISSED' },
    });
  });

  test('narrows to the statuses actually chosen', async () => {
    const wrapper = await render();
    await statusChip(wrapper, 'FIXED').trigger('click');
    await statusChip(wrapper, 'DISMISSED').trigger('click');
    await flushPromises();

    await bulkDismiss(wrapper);

    expect(bulkUpdateAdminReports).toHaveBeenCalledWith({
      status: 'DISMISSED',
      filters: { status: 'OPEN,PROCESSING' },
    });
  });

  test('asks before doing it, because it is not undoable', async () => {
    const wrapper = await render();

    await act(wrapper, 'dismiss-all').trigger('click');
    await nextTick();

    expect(bulkUpdateAdminReports).not.toHaveBeenCalled();
  });
});

describe('selecting groups', () => {
  test('select-all takes every group, and again clears them', async () => {
    const wrapper = await render([group([1, 2]), group([3])]);

    await act(wrapper, 'select-all').trigger('click');
    await nextTick();
    expect(wrapper.get('[data-count]').text()).toBe('2');

    await act(wrapper, 'select-all').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-testid="selection-bar"]').exists()).toBe(false);
  });

  test('a batch status update covers EVERY report in the chosen groups', async () => {
    // A group is several reports about one target; marking one fixed and
    // leaving its siblings open would put the group straight back in the queue.
    const wrapper = await render([group([1, 2]), group([3])]);

    await wrapper.get('[data-select="0"]').trigger('click');
    await nextTick();
    await act(wrapper, 'batch-fixed').trigger('click');
    await flushPromises();

    expect(batchUpdateAdminReports).toHaveBeenCalledWith({ ids: [1, 2], status: 'FIXED' });
  });

  test('a batch DELETE takes only each group’s REPRESENTATIVE', async () => {
    // One call per group rather than per report: the group is removed through
    // its first report, and deleting the siblings too would be as many extra
    // requests as the queue is deep.
    const wrapper = await render([group([1, 2]), group([3])]);

    await act(wrapper, 'select-all').trigger('click');
    await nextTick();
    await act(wrapper, 'batch-delete').trigger('click');
    await flushPromises();

    expect(deleteAdminReport.mock.calls.map(([arg]) => arg)).toEqual([{ reportId: 1 }, { reportId: 3 }]);
  });

  test('a PARTLY failed batch delete says how many of each, rather than one verdict', async () => {
    // `allSettled`, so one failure does not abandon the rest -- and the reader
    // has to be told both numbers or they cannot tell what is left to redo.
    const wrapper = await render([group([1, 2]), group([3])]);
    deleteAdminReport.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'));

    await act(wrapper, 'select-all').trigger('click');
    await nextTick();
    await act(wrapper, 'batch-delete').trigger('click');
    await flushPromises();

    expect(toastSuccess).toHaveBeenCalledWith('reports.admin.batchDeleted');
    expect(toastError).toHaveBeenCalledWith('reports.admin.batchDeletePartialError');
    expect(handleApiError).toHaveBeenCalledWith('reports.batchDelete', expect.anything(), { toastKey: false });
  });

  test('the selection bar is gone when nothing is selected', async () => {
    const wrapper = await render();

    expect(wrapper.find('[data-testid="selection-bar"]').exists()).toBe(false);
  });

  test('clears the selection after a batch update, so the next one starts fresh', async () => {
    const wrapper = await render([group([1, 2])]);
    await act(wrapper, 'select-all').trigger('click');
    await nextTick();

    await act(wrapper, 'batch-fixed').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="selection-bar"]').exists()).toBe(false);
  });
});
