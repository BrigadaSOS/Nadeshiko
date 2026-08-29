// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/**
 * The admin user table: search, page, ban, unban.
 *
 * Both things pinned here are ORDERING faults, which is why neither shows up in
 * a click-through. A page of results is a page of results; you only notice it is
 * the wrong one if you were already watching the count above it.
 */
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

const getAdminUsersWithProviders = vi.fn();
const banUser = vi.fn();
const unbanUser = vi.fn();
const impersonateUser = vi.fn();

vi.stubGlobal('useNadeshikoSdk', () => ({ getAdminUsersWithProviders, banUser, unbanUser }));
vi.stubGlobal('userStore', () => ({ impersonateUser }));
// The count line is the only window onto which page the table thinks it is on,
// so the stub has to carry its params -- one that returns the bare key makes
// every pagination assertion below pass without looking at anything.
vi.stubGlobal('useI18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params
      ? `${key}(${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')})`
      : key,
}));
vi.stubGlobal('useFormat', () => ({
  formatNumber: (n: number) => String(n),
  formatDate: (d: unknown) => String(d),
  formatRelativeTime: (d: unknown) => String(d),
}));
vi.stubGlobal('useToastError', vi.fn());
vi.stubGlobal('useToastSuccess', vi.fn());

import UsersManager from './UsersManager.vue';

const mounted: { unmount: () => void }[] = [];

/** `count` users, named so the page they came from is visible in the table. */
function page(prefix: string, count: number, total: number) {
  return {
    users: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix}-${i}`,
      email: `${prefix}-${i}@x.test`,
      providers: ['google'],
      banned: false,
      createdAt: '2026-01-01',
    })),
    total,
  };
}

/** A promise plus the handles to settle it whenever the test chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function render() {
  const wrapper = mount(UsersManager, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        UiBaseIcon: true,
        SearchDropdownContainer: { template: '<div><slot /><slot name="content" /></div>' },
        SearchDropdownMainButton: { template: '<button><slot /></button>' },
        SearchDropdownItem: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
      },
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  await flush();
  return wrapper;
}

/** Lets pending promise chains settle without leaning on timers. */
async function flush() {
  for (let i = 0; i < 6; i++) await nextTick();
}

/** The user names currently in the table. */
function rows(wrapper: { findAll: (s: string) => { text: () => string }[] }) {
  return wrapper.findAll('tbody tr').map((r) => r.text());
}

/** The "showing start=N" line, which is where `currentOffset` becomes visible. */
function showing(wrapper: { text: () => string }) {
  return /start=(\d+)/.exec(wrapper.text())?.[1];
}

function nextButton(wrapper: {
  findAll: (s: string) => { text: () => string; trigger: (e: string) => Promise<void> }[];
}) {
  return wrapper.findAll('button').find((b) => b.text().includes('pagination.next'))!;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  getAdminUsersWithProviders.mockResolvedValue(page('a', 20, 100));
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('loading the table', () => {
  test('fetches the first page on mount', async () => {
    const wrapper = await render();

    expect(getAdminUsersWithProviders).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }));
    expect(rows(wrapper)).toHaveLength(20);
  });

  test('a failed load is reported rather than swallowed', async () => {
    getAdminUsersWithProviders.mockRejectedValue(new Error('nope'));

    await render();

    expect(handleApiError).toHaveBeenCalledWith('admin:users-fetch-failed', expect.anything(), expect.anything());
  });
});

describe('paging', () => {
  test('the next page replaces the rows and moves the count', async () => {
    const wrapper = await render();
    getAdminUsersWithProviders.mockResolvedValue(page('b', 20, 100));

    await nextButton(wrapper).trigger('click');
    await flush();

    expect(showing(wrapper)).toBe('21');
    expect(rows(wrapper)[0]).toContain('b-0');
  });

  test('a FAILED page does not move the counter off the rows still on screen', async () => {
    // The offset used to advance before the request, and nothing put it back.
    // The reader was left reading "showing 21-40" over page one's rows, and
    // pressing Next again skipped a page that had never been shown.
    const wrapper = await render();
    expect(showing(wrapper)).toBe('1');
    getAdminUsersWithProviders.mockRejectedValue(new Error('nope'));

    await nextButton(wrapper).trigger('click');
    await flush();

    expect(showing(wrapper)).toBe('1');
    expect(rows(wrapper)[0]).toContain('a-0');
  });

  test('a page still in flight cannot overwrite a search made while waiting for it', async () => {
    // The two cannot be raced through the pagination buttons -- the spinner
    // replaces them for the length of the request -- but the SEARCH BOX stays
    // live above it, so pressing Next and then typing leaves two requests out
    // at once. Assigned in arrival order, the slower page reply lands on top of
    // the search the reader is now looking at.
    const wrapper = await render();
    const slowPage = deferred<ReturnType<typeof page>>();
    const fastSearch = deferred<ReturnType<typeof page>>();
    getAdminUsersWithProviders.mockReturnValueOnce(slowPage.promise).mockReturnValueOnce(fastSearch.promise);

    await nextButton(wrapper).trigger('click');
    await wrapper.find('input').setValue('joh');
    vi.advanceTimersByTime(300);
    await nextTick();

    fastSearch.resolve(page('joh', 2, 2));
    await flush();
    slowPage.resolve(page('second', 20, 100));
    await flush();

    expect(rows(wrapper)[0]).toContain('joh-0');
    expect(rows(wrapper)).toHaveLength(2);
  });

  test('an abandoned request FAILING is not reported over the one that succeeded', async () => {
    // The stale reply has to be dropped on both paths. Reported, it puts an
    // error toast over a table that loaded perfectly well, blaming the search
    // the reader is looking at for a page request they had already left.
    const wrapper = await render();
    const slowPage = deferred<ReturnType<typeof page>>();
    const fastSearch = deferred<ReturnType<typeof page>>();
    getAdminUsersWithProviders.mockReturnValueOnce(slowPage.promise).mockReturnValueOnce(fastSearch.promise);

    await nextButton(wrapper).trigger('click');
    await wrapper.find('input').setValue('joh');
    vi.advanceTimersByTime(300);
    await nextTick();

    fastSearch.resolve(page('joh', 2, 2));
    await flush();
    handleApiError.mockClear();
    slowPage.reject(new Error('gone'));
    await flush();

    expect(handleApiError).not.toHaveBeenCalled();
    expect(rows(wrapper)[0]).toContain('joh-0');
  });

  test('an overtaken request does not clear the spinner out from under the live one', async () => {
    // Otherwise the table returns showing the PREVIOUS rows while the request
    // the reader is actually waiting for is still out -- a flash of stale
    // content that reads as the search having finished and found nothing new.
    const wrapper = await render();
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    getAdminUsersWithProviders.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await nextButton(wrapper).trigger('click');
    await wrapper.find('input').setValue('joh');
    vi.advanceTimersByTime(300);
    await nextTick();

    first.resolve(page('second', 20, 100));
    await flush();

    expect(wrapper.find('[role="status"]').exists()).toBe(true);
  });
});

describe('searching', () => {
  test('waits for the reader to stop typing, then restarts at the first page', async () => {
    const wrapper = await render();
    getAdminUsersWithProviders.mockClear();

    await wrapper.find('input').setValue('jo');
    vi.advanceTimersByTime(300);
    await flush();

    expect(getAdminUsersWithProviders).toHaveBeenCalledWith(expect.objectContaining({ search: 'jo', offset: 0 }));
  });

  test('a slow reply for an ABANDONED search never lands', async () => {
    // Type "jo", type "joh": whichever request finishes first used to win, so a
    // slow "jo" arriving late filled the table with results for a search the
    // box no longer shows.
    const wrapper = await render();
    const slow = deferred<ReturnType<typeof page>>();
    const fast = deferred<ReturnType<typeof page>>();
    getAdminUsersWithProviders.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

    await wrapper.find('input').setValue('jo');
    vi.advanceTimersByTime(300);
    await nextTick();
    await wrapper.find('input').setValue('joh');
    vi.advanceTimersByTime(300);
    await nextTick();

    fast.resolve(page('joh', 2, 2));
    await flush();
    slow.resolve(page('jo', 20, 20));
    await flush();

    expect(rows(wrapper)[0]).toContain('joh-0');
    expect(rows(wrapper)).toHaveLength(2);
  });
});
