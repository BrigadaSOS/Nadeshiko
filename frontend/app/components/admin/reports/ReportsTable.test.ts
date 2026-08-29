// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import { useEnterSubmit } from '~/composables/useEnterSubmit';

/**
 * The admin reports table.
 *
 * Mostly markup, but the markup is wired to a parent that owns every piece of
 * state -- selection, expansion, the notes drafts -- so what is worth pinning is
 * the wiring: which click means which emit. Rows expand on click and carry
 * controls that must NOT expand them, and there is no visual difference between
 * a checkbox that only selects and one that also unfolds five sub-rows under the
 * admin's cursor.
 *
 * The notes field is the other half: notes quote the sentence being reported, so
 * they are usually Japanese, and Enter is as likely to be confirming an IME
 * conversion as to mean "save" (#399).
 */
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}(${Object.values(params).join(',')})`,
}));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => String(n),
  formatDate: (d: unknown) => `date:${d}`,
  formatRelativeTime: (d: unknown) => (d ? `ago:${d}` : ''),
}));
vi.stubGlobal('useLocalePath', () => (path: string) => `/en${path}`);
// The real one: its IME handling is the behaviour being checked below, and a
// stub would leave the Japanese case asserted against a double.
vi.stubGlobal('useEnterSubmit', useEnterSubmit);

import ReportsTable from './ReportsTable.vue';

type Group = Record<string, unknown>;

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    source: 'USER',
    reason: 'WRONG_TRANSLATION',
    description: 'the subtitle is off',
    reporterName: 'hana',
    createdAt: '2026-08-01T00:00:00Z',
    adminNotes: null,
    ...overrides,
  };
}

function group(overrides: Group = {}): Group {
  return {
    target: { type: 'SEGMENT', mediaPublicId: 'media-1', episodeNumber: 3, segmentPublicId: 'seg-9' },
    mediaName: 'Some Anime',
    status: 'OPEN',
    reportCount: 2,
    reporterCount: 2,
    firstReportedAt: '2026-08-01T00:00:00Z',
    lastStatusChange: '2026-08-02T00:00:00Z',
    reports: [report(), report({ id: 2, reporterName: 'kenji' })],
    ...overrides,
  };
}

const mounted: { unmount: () => void }[] = [];

function render(
  props: {
    groups?: Group[];
    isLoading?: boolean;
    hasMore?: boolean;
    expandedGroups?: Set<number>;
    selectedIndices?: Set<number>;
    editingNotes?: Record<number, string>;
  } = {},
) {
  const wrapper = mount(ReportsTable, {
    props: {
      groups: [group()],
      isLoading: false,
      hasMore: false,
      expandedGroups: new Set<number>(),
      selectedIndices: new Set<number>(),
      editingNotes: reactive({}),
      ...props,
    } as never,
    global: {
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}

const rows = (wrapper: ReturnType<typeof render>) => wrapper.findAll('[data-testid="report-row"]');
const selectAll = (wrapper: ReturnType<typeof render>) => wrapper.find('thead input[type="checkbox"]');
const rowCheckbox = (wrapper: ReturnType<typeof render>) => wrapper.find('tbody input[type="checkbox"]');
/** The buttons on a row, by the label the `$t` stub gives them. */
const button = (wrapper: ReturnType<typeof render>, label: string) =>
  wrapper.findAll('button').find((b) => b.text().trim() === label);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('selecting', () => {
  test('the header box is ticked only when every visible group is', () => {
    const wrapper = render({ groups: [group(), group()], selectedIndices: new Set([0, 1]) });

    expect(selectAll(wrapper).attributes('checked')).toBeDefined();
  });

  test('and is not ticked when only some are', () => {
    const wrapper = render({ groups: [group(), group()], selectedIndices: new Set([0]) });

    expect(selectAll(wrapper).attributes('checked')).toBeUndefined();
  });

  test('an EMPTY table does not claim everything is selected', () => {
    // `every` is vacuously true on an empty list, so without the length guard
    // the header box arrives ticked over a table with nothing in it, and the
    // bulk bar offers to dismiss a selection of none.
    const wrapper = render({ groups: [], selectedIndices: new Set() });

    expect(selectAll(wrapper).attributes('checked')).toBeUndefined();
  });

  test('ticking a row reports which row, not which report id', () => {
    // The parent tracks selection by index into the visible page.
    const wrapper = render({ groups: [group(), group()] });

    wrapper.findAll('tbody input[type="checkbox"]')[1]?.trigger('change');

    expect(wrapper.emitted('toggle-select')?.[0]).toEqual([1]);
  });

  test('ticking a row does NOT also unfold it', async () => {
    // The checkbox sits inside a row whose whole surface expands; without the
    // click guard, selecting five rows unfolds five rows of detail under the
    // admin's cursor.
    const wrapper = render();

    await rowCheckbox(wrapper).trigger('click');

    expect(wrapper.emitted('toggle-expand')).toBeUndefined();
  });
});

describe('expanding a row', () => {
  test('clicking the row asks the parent to expand it', async () => {
    const wrapper = render({ groups: [group(), group()] });

    await rows(wrapper)[1]?.trigger('click');

    expect(wrapper.emitted('toggle-expand')?.[0]).toEqual([1]);
  });

  test('an expanded row shows one line per report, not just the group', () => {
    // The count column says "2"; the point of expanding is to see who and why.
    const wrapper = render({ expandedGroups: new Set([0]) });

    expect(wrapper.text()).toContain('hana');
    expect(wrapper.text()).toContain('kenji');
  });

  test('a collapsed row shows none of them', () => {
    const wrapper = render();

    expect(wrapper.text()).not.toContain('kenji');
  });

  test('following the title link does not unfold the row behind it', async () => {
    // The admin is leaving the page; expanding it on the way is noise they come
    // back to.
    const wrapper = render();

    await wrapper.find('tbody a').trigger('click');

    expect(wrapper.emitted('toggle-expand')).toBeUndefined();
  });

  test('the action buttons do not unfold it either', async () => {
    const wrapper = render();

    await button(wrapper, 'reports.statuses.FIXED')?.trigger('click');

    expect(wrapper.emitted('toggle-expand')).toBeUndefined();
  });
});

describe('the target', () => {
  test('links to the reported episode, not just the title', () => {
    // A report is about one episode of a hundred; landing on the title leaves
    // the admin to find it again by hand.
    const wrapper = render();

    expect(wrapper.find('tbody a').attributes('href')).toContain('episode=3');
  });

  test('a whole-title report links to the title alone', () => {
    const wrapper = render({
      groups: [group({ target: { type: 'MEDIA', mediaPublicId: 'media-1' } })],
    });

    expect(wrapper.find('tbody a').attributes('href')).not.toContain('episode');
  });

  test('a sentence report links to the sentence as well', () => {
    const wrapper = render();
    const links = wrapper.findAll('tbody a').map((a) => a.attributes('href'));

    expect(links.some((href) => href?.includes('/sentence/seg-9'))).toBe(true);
  });

  test('a report whose target was already DELETED says so instead of linking nowhere', () => {
    // Deleting the segment is one of the ways a report gets resolved, so this
    // is the ordinary end state, not a corrupt row.
    const wrapper = render({ groups: [group({ target: { type: 'SEGMENT', mediaPublicId: null } })] });

    expect(wrapper.find('tbody a').exists()).toBe(false);
    expect(wrapper.text()).toContain('reports.admin.deletedTarget');
  });

  test('falls back to the public id when the title has no name', () => {
    // Better a raw id than an empty cell that reads as a broken row.
    const wrapper = render({ groups: [group({ mediaName: null })] });

    expect(wrapper.find('tbody a').text()).toBe('media-1');
  });
});

describe('acting on a group', () => {
  test.each([
    ['reports.statuses.OPEN', 'OPEN'],
    ['reports.statuses.PROCESSING', 'PROCESSING'],
    ['reports.statuses.FIXED', 'FIXED'],
    ['reports.admin.dismiss', 'DISMISSED'],
  ])('%s sets the status to %s', async (label, status) => {
    const wrapper = render();

    await button(wrapper, label)?.trigger('click');

    expect(wrapper.emitted('update-status')?.[0]).toEqual([1, status]);
  });

  test('deleting reports the id rather than the row index', async () => {
    const wrapper = render({ groups: [group({ reports: [report({ id: 77 })] })] });

    await button(wrapper, 'reports.admin.delete')?.trigger('click');

    expect(wrapper.emitted('delete-report')?.[0]).toEqual([77]);
  });

  test('a group whose reports all vanished offers no actions to fail on', () => {
    const wrapper = render({ groups: [group({ reports: [] })] });

    expect(button(wrapper, 'reports.admin.delete')).toBeUndefined();
  });
});

describe('the admin notes', () => {
  test('clicking a note opens a draft of what is already there', async () => {
    const editingNotes: Record<number, string> = reactive({});
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes,
      groups: [group({ reports: [report({ adminNotes: 'asked the uploader' })] })],
    });

    await wrapper.find('tbody span.cursor-pointer').trigger('click');

    expect(editingNotes[1]).toBe('asked the uploader');
  });

  test('a report with no note opens an EMPTY draft, not the word null', async () => {
    const editingNotes: Record<number, string> = reactive({});
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes,
      groups: [group({ reports: [report({ adminNotes: null })] })],
    });

    await wrapper.find('tbody span.cursor-pointer').trigger('click');

    expect(editingNotes[1]).toBe('');
  });

  test('the draft is what shows an input rather than the note', async () => {
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: 'a draft' }),
      groups: [group({ reports: [report()] })],
    });

    expect(wrapper.find('tbody input:not([type="checkbox"])').exists()).toBe(true);
  });

  test('Escape abandons the draft, leaving the saved note alone', async () => {
    const editingNotes: Record<number, string> = reactive({ 1: 'half typed' });
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes,
      groups: [group({ reports: [report({ adminNotes: 'the saved one' })] })],
    });

    await wrapper.find('tbody input:not([type="checkbox"])').trigger('keyup.escape');
    await nextTick();

    expect(editingNotes[1]).toBeUndefined();
    expect(wrapper.text()).toContain('the saved one');
  });

  test('Enter saves', async () => {
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: 'done' }),
      groups: [group({ reports: [report()] })],
    });

    await wrapper.find('tbody input:not([type="checkbox"])').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('save-notes')?.[0]).toEqual([1]);
  });

  test('the Enter that CONFIRMS a Japanese conversion does not', async () => {
    // Notes quote the sentence being reported, so they are usually Japanese.
    // Saving on the confirming press stores whatever the field held before the
    // reader started typing -- an empty note (#399).
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: '' }),
      groups: [group({ reports: [report()] })],
    });
    const input = wrapper.find('tbody input:not([type="checkbox"])');

    await input.trigger('keydown', { key: 'Enter', isComposing: true });

    expect(wrapper.emitted('save-notes')).toBeUndefined();
  });

  test('and the reader’s own next Enter still saves', async () => {
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: '確認した' }),
      groups: [group({ reports: [report()] })],
    });
    const input = wrapper.find('tbody input:not([type="checkbox"])');

    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    await input.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('save-notes')).toHaveLength(1);
  });

  test('the save button saves too, for anyone who does not press Enter', async () => {
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: 'done' }),
      groups: [group({ reports: [report()] })],
    });

    await button(wrapper, 'reports.admin.save')?.trigger('click');

    expect(wrapper.emitted('save-notes')?.[0]).toEqual([1]);
  });

  test('two rows in draft at once do not save each other', async () => {
    // The listeners are built per report id inside a `v-for`, so a shared
    // closure would send both drafts to whichever id rendered last.
    const wrapper = render({
      expandedGroups: new Set([0]),
      editingNotes: reactive({ 1: 'a', 2: 'b' }),
      groups: [group({ reports: [report({ id: 1 }), report({ id: 2 })] })],
    });

    await wrapper.findAll('tbody input:not([type="checkbox"])')[1]?.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('save-notes')?.[0]).toEqual([2]);
  });
});

describe('the state of the list', () => {
  test('says there is nothing here when there is nothing here', () => {
    const wrapper = render({ groups: [] });

    expect(wrapper.text()).toContain('reports.noReports');
  });

  test('does NOT say that while the first page is still loading', () => {
    // "No reports" under a spinner is the message an admin screenshots.
    const wrapper = render({ groups: [], isLoading: true });

    expect(wrapper.text()).not.toContain('reports.noReports');
  });

  test('shows a spinner only for the first page, not for load-more', () => {
    // Loading more already has its own button state; a second spinner below
    // the rows reads as the table reloading.
    const withRows = render({ groups: [group()], isLoading: true, hasMore: true });

    expect(withRows.find('[role="status"]').exists()).toBe(false);
    expect(render({ groups: [], isLoading: true }).find('[role="status"]').exists()).toBe(true);
  });

  test('offers more only when there IS more', () => {
    expect(button(render({ hasMore: false }), 'reports.loadMore')).toBeUndefined();
    expect(button(render({ hasMore: true }), 'reports.loadMore')).toBeDefined();
  });

  test('the load-more button cannot be pressed twice while it is working', () => {
    const wrapper = render({ groups: [group()], hasMore: true, isLoading: true });
    const more = wrapper.findAll('button').at(-1);

    expect(more?.attributes('disabled')).toBeDefined();
    expect(more?.text()).toContain('reports.loading');
  });
});

describe('the reporter count', () => {
  test('names the distinct reporters, each once', () => {
    // Ten reports from one person is a different situation from ten people, and
    // the tooltip is where an admin tells them apart.
    const wrapper = render({
      groups: [
        group({
          reporterCount: 2,
          reports: [
            report({ reporterName: 'hana' }),
            report({ id: 2, reporterName: 'hana' }),
            report({ id: 3, reporterName: 'kenji' }),
          ],
        }),
      ],
    });

    expect(wrapper.find('.cursor-help').attributes('title')).toBe('hana, kenji');
  });

  test('is left off entirely when nobody is named', () => {
    // Discord reports arrive without one, and "reported by 0 people" is worse
    // than silence.
    const wrapper = render({ groups: [group({ reporterCount: 0 })] });

    expect(wrapper.find('.cursor-help').exists()).toBe(false);
  });
});
