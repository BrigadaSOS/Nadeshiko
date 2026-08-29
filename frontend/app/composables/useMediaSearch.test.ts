import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

/**
 * The one debounced catalogue lookup behind `/user/media`.
 *
 * There used to be two of these -- one in the favorites panel, one in the
 * hidden-media panel, same debounce, same `take`, same failure handling -- which
 * is what had that page asking the backend the same question twice per
 * keystroke.
 *
 * The distinction worth keeping is `failed` versus "nothing matched". A search
 * outage rendered as an empty result list tells the reader their catalogue is
 * empty, which is both wrong and unactionable; they need to know to try again.
 */
const sdk = { searchMedia: vi.fn() };
const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('useNadeshikoSdk', () => sdk);

import { useMediaSearch } from './useMediaSearch';

const DEBOUNCE_MS = 120;
const media = (publicId: string) => ({ publicId, nameEn: publicId });

/** Types into the box and lets the debounce elapse. */
async function type(search: ReturnType<typeof useMediaSearch>, value: string) {
  search.query.value = value;
  await nextTick();
  vi.advanceTimersByTime(DEBOUNCE_MS);
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  sdk.searchMedia.mockResolvedValue({ media: [media('media-1')] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searching', () => {
  test('asks the catalogue once the reader stops typing', async () => {
    const search = useMediaSearch('user-media:search-failed');

    await type(search, 'oshi');

    expect(sdk.searchMedia).toHaveBeenCalledWith({ query: 'oshi', take: 25 });
    expect(search.results.value).toEqual([media('media-1')]);
  });

  test('does NOT ask on every keystroke', async () => {
    // The whole point of the debounce: a five-letter title is one request, not
    // five.
    const search = useMediaSearch('k');

    search.query.value = 'o';
    await nextTick();
    search.query.value = 'os';
    await nextTick();
    search.query.value = 'osh';
    await nextTick();
    expect(sdk.searchMedia).not.toHaveBeenCalled();

    // Just short of the debounce: still nothing. Advancing the whole window in
    // one step would pass just as well with no debounce at all.
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await flushPromises();
    expect(sdk.searchMedia).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(sdk.searchMedia).toHaveBeenCalledTimes(1);
  });

  test('asks for what the reader last typed, not what they typed first', async () => {
    const search = useMediaSearch('k');

    search.query.value = 'o';
    await nextTick();
    search.query.value = 'oshi';
    await nextTick();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await flushPromises();

    expect(sdk.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ query: 'oshi' }));
  });

  test('trims the query, so a trailing space is not a different search', async () => {
    const search = useMediaSearch('k');

    await type(search, '  oshi  ');

    expect(sdk.searchMedia).toHaveBeenCalledWith(expect.objectContaining({ query: 'oshi' }));
  });

  test('reports that it is working, and that it has stopped', async () => {
    const search = useMediaSearch('k');
    let resolve = (_: unknown) => {};
    sdk.searchMedia.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    search.query.value = 'oshi';
    await nextTick();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    await nextTick();
    expect(search.loading.value).toBe(true);

    resolve({ media: [] });
    await flushPromises();
    expect(search.loading.value).toBe(false);
  });
});

describe('emptying the box', () => {
  test('clears the results rather than searching for nothing', async () => {
    const search = useMediaSearch('k');
    await type(search, 'oshi');
    expect(search.results.value).toHaveLength(1);

    await type(search, '');

    expect(search.results.value).toEqual([]);
    expect(sdk.searchMedia).toHaveBeenCalledTimes(1);
  });

  test('whitespace alone counts as empty', async () => {
    const search = useMediaSearch('k');

    await type(search, '   ');

    expect(sdk.searchMedia).not.toHaveBeenCalled();
  });

  test('cancels a search that was already scheduled', async () => {
    // Otherwise the reader clears the box and the results reappear a moment
    // later, on top of the panel they went back to.
    const search = useMediaSearch('k');

    search.query.value = 'oshi';
    await nextTick();
    search.query.value = '';
    await nextTick();
    vi.advanceTimersByTime(DEBOUNCE_MS * 5);
    await flushPromises();

    expect(sdk.searchMedia).not.toHaveBeenCalled();
    expect(search.results.value).toEqual([]);
  });
});

describe('a search that FAILED', () => {
  beforeEach(() => {
    sdk.searchMedia.mockRejectedValue(new Error('offline'));
  });

  test('says so, rather than showing an empty catalogue', async () => {
    // "No titles match" and "the search is down" call for opposite reactions
    // from the reader.
    const search = useMediaSearch('k');

    await type(search, 'oshi');

    expect(search.failed.value).toBe(true);
  });

  test('drops the PREVIOUS search’s results rather than leaving them under the error', async () => {
    // Otherwise the panel shows the last good matches beside "the search
    // failed", and the reader acts on rows that answer a different question.
    sdk.searchMedia.mockResolvedValue({ media: [media('media-1')] });
    const search = useMediaSearch('k');
    await type(search, 'oshi');
    expect(search.results.value).toHaveLength(1);

    sdk.searchMedia.mockRejectedValue(new Error('offline'));
    await type(search, 'kanji');

    expect(search.results.value).toEqual([]);
  });

  test('stops reporting that it is loading', async () => {
    const search = useMediaSearch('k');

    await type(search, 'oshi');

    expect(search.loading.value).toBe(false);
  });

  test('is recorded under the caller’s own key, since two panels share this', async () => {
    const search = useMediaSearch('hidden-media:search-failed');

    await type(search, 'oshi');

    expect(handleApiError).toHaveBeenCalledWith('hidden-media:search-failed', expect.anything(), expect.anything());
  });

  test('does not raise a toast, because the box itself shows the state', async () => {
    const search = useMediaSearch('k');

    await type(search, 'oshi');

    expect(handleApiError).toHaveBeenCalledWith(expect.anything(), expect.anything(), { toastKey: false });
  });

  test('and the next search that works clears the failure', async () => {
    // Otherwise the panel stays in an error state over perfectly good results.
    const search = useMediaSearch('k');
    await type(search, 'oshi');
    expect(search.failed.value).toBe(true);

    sdk.searchMedia.mockResolvedValue({ media: [media('media-2')] });
    await type(search, 'kanji');

    expect(search.failed.value).toBe(false);
    expect(search.results.value).toEqual([media('media-2')]);
  });

  test('and emptying the box clears it too', async () => {
    const search = useMediaSearch('k');
    await type(search, 'oshi');

    await type(search, '');

    expect(search.failed.value).toBe(false);
  });
});
