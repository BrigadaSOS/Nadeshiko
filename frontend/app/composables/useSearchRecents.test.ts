import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The recents menu under the search bar.
 *
 * `utils/searchRecents` already covers the dedupe, tombstone and narrowing
 * rules; this covers the composable that puts the two copies together, which is
 * where the decisions are:
 *
 * THE DEVICE IS THE PRIMARY COPY. Every reader has a list in `localStorage`,
 * signed in or not, because a signed-out reader has nowhere else to keep one and
 * the list has to survive being offline. The account's rows merge into it.
 *
 * CLEARING ASKS THE ACCOUNT FIRST. A clear that emptied the browser while the
 * account still held the rows is a privacy bug wearing a sync bug's coat -- the
 * reader believes their history is gone and it is not.
 *
 * SIGNING OUT DROPS THE ACCOUNT'S HALF ON THE SPOT. `loadedFor` records WHO the
 * loaded rows belong to rather than merely that some were loaded, so a session
 * change re-asks; a bare flag would have left the previous reader's searches in
 * the menu.
 */
const sdk = {
  listUserActivity: vi.fn(),
  deleteUserActivity: vi.fn(),
  deleteUserActivityById: vi.fn(),
};
/**
 * Reactive, because the real `userStore()` is: `identity` is a `computed` over
 * these fields, and a plain object would never re-evaluate it -- so a session
 * change would silently look like no change at all.
 */
const user = reactive({
  isLoggedIn: false,
  userEmail: null as string | null,
  preferences: {} as Record<string, unknown>,
});

const reportError = vi.fn();
vi.mock('~/utils/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a), reportEvent: vi.fn() }));

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

const STORAGE_KEY = 'nd-search-recents';

/** Re-imports the composable, which keeps module-level hydration state. */
async function loadComposable() {
  vi.resetModules();
  return (await import('./useSearchRecents')).useSearchRecents;
}

/** An account activity row as `listUserActivity` returns it. */
function activity(id: number, searchQuery: string, extra: Record<string, unknown> = {}) {
  return { id, searchQuery, createdAt: `2026-08-${String(id).padStart(2, '0')}T00:00:00.000Z`, ...extra };
}

/** What the device list holds right now, as the menu would read it. */
function stored() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = false;
  user.userEmail = null;
  user.preferences = {};
  sdk.listUserActivity.mockResolvedValue({ activities: [] });
  sdk.deleteUserActivity.mockResolvedValue({});
  sdk.deleteUserActivityById.mockResolvedValue({});
  localStorage.clear();
});

describe('the device list', () => {
  test('remembers a search', async () => {
    const recents = (await loadComposable())();

    recents.remember('食べる');

    expect(recents.recents.value.map((r) => r.query)).toEqual(['食べる']);
  });

  test('survives a reload, which is what makes it the primary copy', async () => {
    // A signed-out reader has nowhere else to keep one, and the list has to
    // work offline.
    (await loadComposable())().remember('食べる');

    const reopened = (await loadComposable())();
    await reopened.load();

    expect(reopened.recents.value.map((r) => r.query)).toEqual(['食べる']);
  });

  test('puts the newest search first', async () => {
    const recents = (await loadComposable())();

    recents.remember('first');
    recents.remember('second');

    expect(recents.recents.value.map((r) => r.query)).toEqual(['second', 'first']);
  });

  test('ignores an empty search', async () => {
    const recents = (await loadComposable())();

    recents.remember('   ');

    expect(recents.recents.value).toEqual([]);
  });

  test('records the title a search was made inside, since that is a different search', async () => {
    const recents = (await loadComposable())();

    recents.remember('食べる', { publicId: 'media-1', name: 'Oshi no Ko' });

    expect(recents.recents.value[0]?.media).toMatchObject({ publicId: 'media-1' });
  });

  test('keeps the same query in two titles as two rows', async () => {
    const recents = (await loadComposable())();

    recents.remember('食べる');
    recents.remember('食べる', { publicId: 'media-1' });

    expect(recents.recents.value).toHaveLength(2);
  });

  test('a search that could not be written down does not interrupt the search itself', async () => {
    // A full quota, or a browser in private mode.
    const recents = (await loadComposable())();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => recents.remember('食べる')).not.toThrow();
    expect(reportError).toHaveBeenCalledWith('search-recents:persist-failed', expect.anything());
    vi.restoreAllMocks();
  });

  test('a hand-edited store starts a fresh list rather than failing to open', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const recents = (await loadComposable())();

    await recents.load();

    expect(recents.recents.value).toEqual([]);
  });

  test('a store from a shape this version does not know is discarded', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 99, entries: 'not an array' }));
    const recents = (await loadComposable())();

    await recents.load();

    expect(recents.recents.value).toEqual([]);
  });
});

describe('recording can be switched off', () => {
  test('a search is not written down when the account has it disabled', async () => {
    // The account's toggle governs the device list too, so turning it off on
    // one device stops the recording the reader can actually see.
    user.preferences = { searchHistory: { enabled: false } };
    const recents = (await loadComposable())();

    recents.remember('食べる');

    expect(recents.recents.value).toEqual([]);
  });

  test('turning it off does not erase what is already there', async () => {
    // Stopping and forgetting are different requests.
    const first = (await loadComposable())();
    first.remember('食べる');

    user.preferences = { searchHistory: { enabled: false } };
    const reopened = (await loadComposable())();
    await reopened.load();

    expect(reopened.recents.value.map((r) => r.query)).toEqual(['食べる']);
  });

  test('recording is on when the account says nothing about it', async () => {
    expect((await loadComposable())().isRecording.value).toBe(true);
  });
});

describe('the account list', () => {
  test('is not asked for at all when signed out', async () => {
    const recents = (await loadComposable())();

    await recents.load();

    expect(sdk.listUserActivity).not.toHaveBeenCalled();
  });

  test('merges into the device list for a signed-in reader', async () => {
    user.isLoggedIn = true;
    user.userEmail = 'reader@example.com';
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(1, 'from-account')] });
    const recents = (await loadComposable())();
    recents.remember('from-device');

    await recents.load();

    expect(recents.recents.value.map((r) => r.query).sort()).toEqual(['from-account', 'from-device']);
  });

  test('is fetched once, not on every open', async () => {
    // The bar renders on four pages, including cached ones.
    user.isLoggedIn = true;
    user.userEmail = 'reader@example.com';
    const recents = (await loadComposable())();

    await recents.load();
    await recents.load();

    expect(sdk.listUserActivity).toHaveBeenCalledTimes(1);
  });

  test('coalesces two opens that race', async () => {
    user.isLoggedIn = true;
    user.userEmail = 'reader@example.com';
    const recents = (await loadComposable())();

    await Promise.all([recents.load(), recents.load()]);

    expect(sdk.listUserActivity).toHaveBeenCalledTimes(1);
  });

  test('is re-fetched when a DIFFERENT reader signs in', async () => {
    // `loadedFor` records who the rows belong to; a bare flag would have left
    // the previous reader's searches in the menu.
    user.isLoggedIn = true;
    user.userEmail = 'first@example.com';
    const recents = (await loadComposable())();
    await recents.load();

    user.userEmail = 'second@example.com';
    await recents.load();

    expect(sdk.listUserActivity).toHaveBeenCalledTimes(2);
  });

  test('drops the account half the moment the reader signs out', async () => {
    user.isLoggedIn = true;
    user.userEmail = 'reader@example.com';
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(1, 'from-account')] });
    const recents = (await loadComposable())();
    await recents.load();

    user.isLoggedIn = false;

    expect(recents.recents.value).toEqual([]);
  });

  test('carries the title an account search was made inside', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockResolvedValue({
      activities: [activity(1, '食べる', { mediaPublicId: 'media-1', mediaName: 'Oshi no Ko' })],
    });
    const recents = (await loadComposable())();

    await recents.load();

    expect(recents.recents.value[0]?.media).toMatchObject({ publicId: 'media-1', name: 'Oshi no Ko' });
  });

  test('ignores account rows with no query on them', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(1, ''), activity(2, '食べる')] });
    const recents = (await loadComposable())();

    await recents.load();

    expect(recents.recents.value).toHaveLength(1);
  });

  test('a failed fetch leaves the device list on screen and says nothing to the reader', async () => {
    // A reader who opened the box to search does not need a toast about the
    // half of the menu they cannot see being missing.
    user.isLoggedIn = true;
    sdk.listUserActivity.mockRejectedValue(new Error('offline'));
    const recents = (await loadComposable())();
    recents.remember('from-device');

    await recents.load();

    expect(recents.recents.value.map((r) => r.query)).toEqual(['from-device']);
    expect(handleApiError).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith('search-recents:account-fetch-failed', expect.anything());
  });

  test('a failed fetch is retried on the next open', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockRejectedValueOnce(new Error('offline'));
    const recents = (await loadComposable())();

    await recents.load();
    await recents.load();

    expect(sdk.listUserActivity).toHaveBeenCalledTimes(2);
  });

  test('reports it is loading while the fetch is in flight', async () => {
    user.isLoggedIn = true;
    let release: (value: unknown) => void = () => {};
    sdk.listUserActivity.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const recents = (await loadComposable())();

    const pending = recents.load();
    expect(recents.loading.value).toBe(true);

    release({ activities: [] });
    await pending;
    expect(recents.loading.value).toBe(false);
  });
});

describe('forgetting one entry', () => {
  test('removes it from the device list', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');
    recents.remember('飲む');

    await recents.forget(recents.recents.value[0]!);

    expect(recents.recents.value.map((r) => r.query)).toEqual(['食べる']);
  });

  test('forgets it by key, so the same query in another title survives', async () => {
    // They are two rows because they are two searches.
    const recents = (await loadComposable())();
    recents.remember('食べる');
    recents.remember('食べる', { publicId: 'media-1' });
    const scoped = recents.recents.value.find((r) => r.media)!;

    await recents.forget(scoped);

    expect(recents.recents.value).toHaveLength(1);
    expect(recents.recents.value[0]?.media).toBeUndefined();
  });

  test('stays forgotten across a reload', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');
    await recents.forget(recents.recents.value[0]!);

    const reopened = (await loadComposable())();
    await reopened.load();

    expect(reopened.recents.value).toEqual([]);
  });

  test('holds back the matching ACCOUNT rows too, which this device never saw the ids of', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(1, '食べる')] });
    const recents = (await loadComposable())();
    await recents.load();

    await recents.forget(recents.recents.value[0]!);

    expect(recents.recents.value).toEqual([]);
  });

  test('deletes the account rows it does have ids for', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(7, '食べる')] });
    const recents = (await loadComposable())();
    await recents.load();

    await recents.forget(recents.recents.value[0]!);

    expect(sdk.deleteUserActivityById).toHaveBeenCalledWith(7);
  });

  test('does not call the API for a signed-out reader', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');

    await recents.forget(recents.recents.value[0]!);

    expect(sdk.deleteUserActivityById).not.toHaveBeenCalled();
  });

  test('a failed row delete still leaves the entry gone from this device', async () => {
    user.isLoggedIn = true;
    sdk.listUserActivity.mockResolvedValue({ activities: [activity(7, '食べる')] });
    sdk.deleteUserActivityById.mockRejectedValue(new Error('offline'));
    const recents = (await loadComposable())();
    await recents.load();

    await recents.forget(recents.recents.value[0]!);

    expect(recents.recents.value).toEqual([]);
    expect(reportError).toHaveBeenCalledWith('search-recents:forget-failed', expect.anything());
  });

  test('searching for it again brings it back', async () => {
    // The tombstone has done its job and would now be holding back a row the
    // reader has asked for.
    const recents = (await loadComposable())();
    recents.remember('食べる');
    await recents.forget(recents.recents.value[0]!);

    recents.remember('食べる');

    expect(recents.recents.value.map((r) => r.query)).toEqual(['食べる']);
  });
});

describe('clearing the list', () => {
  test('empties the device list for a signed-out reader', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');

    await recents.clear();

    expect(recents.recents.value).toEqual([]);
    expect(sdk.deleteUserActivity).not.toHaveBeenCalled();
  });

  test('asks the ACCOUNT first, and wipes the device only once it answers', async () => {
    // A clear that emptied the browser while the account still held the rows is
    // a privacy bug wearing a sync bug's coat.
    user.isLoggedIn = true;
    const order: string[] = [];
    sdk.deleteUserActivity.mockImplementation(async () => void order.push('account'));
    const recents = (await loadComposable())();
    recents.remember('食べる');

    await recents.clear();

    expect(order).toEqual(['account']);
    expect(recents.recents.value).toEqual([]);
  });

  test('KEEPS the device list when the account refuses', async () => {
    // The reader would otherwise believe their history is gone when it is not.
    user.isLoggedIn = true;
    sdk.deleteUserActivity.mockRejectedValue(new Error('offline'));
    const recents = (await loadComposable())();
    recents.remember('食べる');

    await recents.clear();

    expect(recents.recents.value.map((r) => r.query)).toEqual(['食べる']);
    expect(handleApiError).toHaveBeenCalledWith(
      'search-recents:clear-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: expect.any(String) }),
    );
  });

  test('drops the tombstones too, since nothing is left to hold back', async () => {
    // The map would otherwise outlive every entry it was written for.
    const recents = (await loadComposable())();
    recents.remember('食べる');
    await recents.forget(recents.recents.value[0]!);

    await recents.clear();

    expect(stored()).toMatchObject({ entries: [], dismissed: {} });
  });

  test('a second clear while the first is in flight is dropped', async () => {
    user.isLoggedIn = true;
    let release: (value: unknown) => void = () => {};
    sdk.deleteUserActivity.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const recents = (await loadComposable())();

    const first = recents.clear();
    await recents.clear();

    expect(sdk.deleteUserActivity).toHaveBeenCalledTimes(1);
    release({});
    await first;
  });
});

describe('narrowing to what is in the box', () => {
  test('matches on a prefix of the query', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');
    recents.remember('飲む');

    expect(recents.narrow('食').map((r) => r.query)).toEqual(['食べる']);
  });

  test('an empty term offers the whole list', async () => {
    const recents = (await loadComposable())();
    recents.remember('食べる');

    expect(recents.narrow('')).toHaveLength(1);
  });

  test('caps how many rows the menu is offered', async () => {
    // Discord-style menus have a hard limit; this one is a rendered dropdown,
    // and an unbounded list is a page of history over the search results.
    const recents = (await loadComposable())();
    for (let i = 0; i < 30; i++) recents.remember(`query-${i}`);

    expect(recents.narrow('query').length).toBeLessThanOrEqual(10);
  });
});
