// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';

/**
 * The spot-check screen for the moderation agent's edits.
 *
 * With no moderators nobody reviews every agent edit, so the safeguard is
 * sampling a few and undoing one in a click -- which is why the before/after
 * diff is inline rather than a link out. That makes the DIFF the screen: it has
 * to show the fields that actually moved and nothing else, because an edit
 * touches one or two of eleven and a full dump buries the change it exists to
 * surface.
 *
 * Values are compared structurally, not by reference, or a re-serialised object
 * that is byte-identical reads as a change.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
const toastSuccess = vi.fn();
vi.mock('~/utils/toast', () => ({ useToastSuccess: (...a: unknown[]) => toastSuccess(...a), useToastError: vi.fn() }));

const listAgentActivity = vi.fn();
const restoreSegmentRevision = vi.fn();

vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, locale: ref('en') }));
vi.stubGlobal('useFormat', () => ({
  formatRelativeTime: (d: unknown) => String(d),
  formatDate: (d: unknown) => String(d),
}));
vi.stubGlobal('useLocalePath', () => (p: string) => `/en${p}`);
vi.stubGlobal('useToastSuccess', toastSuccess);
vi.stubGlobal('useNadeshikoSdk', () => ({ listAgentActivity, restoreSegmentRevision }));

import AgentActivityManager from './AgentActivityManager.vue';

const entry = (over: Record<string, unknown> = {}) => ({
  revisionId: 1,
  revisionNumber: 4,
  segmentPublicId: 's1',
  mediaPublicId: 'm1',
  episodeNumber: 2,
  snapshot: { textJa: 'before', textEn: 'same', status: 'ACTIVE' },
  current: { textJa: 'after', textEn: 'same', status: 'ACTIVE' },
  reportId: null,
  actedBy: 'agent',
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const mounted: { unmount: () => void }[] = [];

/** `null` leaves the mock alone, so a test can arrange a REJECTION first --
 *  `undefined` cannot, because a default parameter would swallow it. */
async function render(entries: ReturnType<typeof entry>[] | null = [entry()]) {
  if (entries !== null) listAgentActivity.mockResolvedValue({ entries });
  const wrapper = mount(AgentActivityManager, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, UiBaseIcon: true },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
}

const rows = (w: ReturnType<typeof mount>) => w.findAll('tbody tr');
/** The diff lines rendered for the first row. */
const diffText = (w: ReturnType<typeof mount>) => rows(w)[0]?.text() ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  // Implementations too: `clearAllMocks` only clears the call log, so a
  // rejection set in one test would otherwise leak into every later one.
  listAgentActivity.mockReset();
  restoreSegmentRevision.mockReset();
  restoreSegmentRevision.mockResolvedValue({});
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('the diff', () => {
  test('shows a field that moved', async () => {
    const wrapper = await render();

    expect(diffText(wrapper)).toContain('before');
    expect(diffText(wrapper)).toContain('after');
  });

  test('and NOT the fields that did not', async () => {
    // An edit touches one or two of eleven; a full dump buries the change.
    const wrapper = await render();

    expect(diffText(wrapper)).not.toContain('same');
  });

  test('compares structurally, so a re-serialised object is not a change', async () => {
    // Same content, different object identity.
    const wrapper = await render([entry({ snapshot: { tags: ['a', 'b'] }, current: { tags: ['a', 'b'] } })]);

    expect(diffText(wrapper)).not.toContain('"a"');
  });

  test('but a changed object IS shown', async () => {
    const wrapper = await render([entry({ snapshot: { tags: ['a'] }, current: { tags: ['a', 'b'] } })]);

    expect(diffText(wrapper)).toContain('"b"');
  });

  test('a field ADDED by the edit counts as a change', async () => {
    // The union of both key sets, not just the snapshot's -- otherwise a field
    // the agent introduced is invisible.
    const wrapper = await render([entry({ snapshot: {}, current: { textJa: 'new text' } })]);

    expect(diffText(wrapper)).toContain('new text');
  });

  test('and so does one it removed', async () => {
    const wrapper = await render([entry({ snapshot: { textJa: 'gone' }, current: {} })]);

    expect(diffText(wrapper)).toContain('gone');
  });

  test('an absent value reads as a dash rather than "undefined"', async () => {
    const wrapper = await render([entry({ snapshot: { textJa: null }, current: { textJa: 'x' } })]);

    expect(diffText(wrapper)).toContain('—');
    expect(diffText(wrapper)).not.toContain('undefined');
  });
});

describe('loading the window', () => {
  test('asks for the chosen number of days', async () => {
    await render();

    const since = new Date(listAgentActivity.mock.calls[0]![0].since).getTime();
    expect(Date.now() - since).toBeGreaterThan(20 * 60 * 60 * 1000);
  });

  test('refetches when the window changes', async () => {
    const wrapper = await render();
    listAgentActivity.mockClear();

    await wrapper.find('select').setValue('7');
    await flushPromises();

    expect(listAgentActivity).toHaveBeenCalled();
  });

  test('a failed load is reported', async () => {
    // `render(null)`, not `render()`: the helper sets a resolved value for any
    // other argument and would overwrite this rejection.
    listAgentActivity.mockImplementation(() => Promise.reject(new Error('down')));
    await render(null);

    expect(handleApiError).toHaveBeenCalledWith('agentActivity.fetch', expect.anything());
  });

  test('an empty window says so rather than showing an empty table', async () => {
    const wrapper = await render([]);

    expect(wrapper.text()).toContain('agentActivity');
  });
});

describe('undoing an edit', () => {
  test('restores the revision the row is about', async () => {
    const wrapper = await render();

    await wrapper.find('tbody button').trigger('click');
    await flushPromises();

    expect(restoreSegmentRevision).toHaveBeenCalledWith({ segmentPublicId: 's1', revisionNumber: 4 });
  });

  test('REFETCHES rather than dropping the row', async () => {
    // The restore writes a new revision, and showing that is the honest view of
    // what the table now contains.
    const wrapper = await render();
    listAgentActivity.mockClear();

    await wrapper.find('tbody button').trigger('click');
    await flushPromises();

    expect(listAgentActivity).toHaveBeenCalled();
  });

  test('a failed restore is reported and the row stays', async () => {
    restoreSegmentRevision.mockRejectedValue(new Error('down'));
    const wrapper = await render();

    await wrapper.find('tbody button').trigger('click');
    await flushPromises();

    expect(handleApiError).toHaveBeenCalledWith('agentActivity.restore', expect.anything(), expect.anything());
    expect(rows(wrapper)).toHaveLength(1);
  });
});
