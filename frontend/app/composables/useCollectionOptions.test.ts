import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The collections list behind the "add to collection" picker on a result card.
 *
 * The whole reason it is a composable rather than component state: it lived
 * inside the card, so its "already loaded" guard was per instance -- a page of
 * thirty results fetched the same list thirty times over, once per dropdown
 * opened, and a failure toasted once per card. The list belongs to the reader.
 *
 * Two further decisions are worth pinning, and both are about what the picker
 * shows when something went wrong:
 *
 * - A FAILED LOAD LEAVES `loaded` FALSE. An empty list that claims to be loaded
 *   reads to the reader as "you have no collections yet", which is a different
 *   and much worse message than "that did not load".
 * - THE REMEMBERED COLLECTION IS VERIFIED. It comes from `localStorage` and can
 *   name one the reader has since deleted; quick-adding into it would fail on
 *   every card.
 */
const sdk = { listCollections: vi.fn() };
const user = reactive({ isLoggedIn: true });

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

const STORAGE_KEY = 'nd-last-collection';

/** Re-imports the composable, which keeps module-level load state. */
async function loadComposable() {
  vi.resetModules();
  return (await import('./useCollectionOptions')).useCollectionOptions;
}

/** A collection as `listCollections` returns it. */
function collection(publicId: string, name: string, type = 'USER') {
  return { publicId, name, type };
}

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  sdk.listCollections.mockResolvedValue({ collections: [] });
  localStorage.clear();
});

describe('loading the list', () => {
  test('fetches the reader’s collections', async () => {
    sdk.listCollections.mockResolvedValue({ collections: [collection('c-1', 'Vocab')] });
    const options = (await loadComposable())();

    await options.load();

    expect(options.collections.value).toEqual([{ id: 'c-1', name: 'Vocab' }]);
    expect(options.loaded.value).toBe(true);
  });

  test('fetches ONCE for a whole page of result cards', async () => {
    // The defect this composable was extracted to fix: thirty cards, thirty
    // identical requests.
    const options = (await loadComposable())();

    await options.load();
    await options.load();
    await options.load();

    expect(sdk.listCollections).toHaveBeenCalledTimes(1);
  });

  test('two pickers opened at once share one request', async () => {
    const options = (await loadComposable())();

    await Promise.all([options.load(), options.load()]);

    expect(sdk.listCollections).toHaveBeenCalledTimes(1);
  });

  test('does not ask at all for a signed-out reader', async () => {
    user.isLoggedIn = false;
    const options = (await loadComposable())();

    await options.load();

    expect(sdk.listCollections).not.toHaveBeenCalled();
  });

  test('hides the Anki exports collection, which is app bookkeeping', async () => {
    // The reader never made it and cannot usefully add to it by hand.
    sdk.listCollections.mockResolvedValue({
      collections: [collection('c-1', 'Vocab'), collection('c-anki', 'Anki Exports', 'ANKI_EXPORT')],
    });
    const options = (await loadComposable())();

    await options.load();

    expect(options.collections.value.map((c) => c.id)).toEqual(['c-1']);
  });

  test('reports it is loading while the request is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    sdk.listCollections.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const options = (await loadComposable())();

    const pending = options.load();
    expect(options.loading.value).toBe(true);

    release({ collections: [] });
    await pending;
    expect(options.loading.value).toBe(false);
  });
});

describe('when the list will not load', () => {
  beforeEach(() => {
    sdk.listCollections.mockRejectedValue(new Error('offline'));
  });

  test('does NOT report itself as loaded', async () => {
    // An empty list that claims to be loaded reads as "you have no collections
    // yet", which is a different message entirely.
    const options = (await loadComposable())();

    await options.load();

    expect(options.loaded.value).toBe(false);
  });

  test('tells the reader, because they are looking at the picker right now', async () => {
    const options = (await loadComposable())();

    await options.load();

    expect(handleApiError).toHaveBeenCalledWith(
      'collections:picker-load-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: expect.any(String) }),
    );
  });

  test('retries on the next open', async () => {
    const options = (await loadComposable())();

    await options.load();
    await options.load();

    expect(sdk.listCollections).toHaveBeenCalledTimes(2);
  });

  test('clears the loading flag, so the picker is not stuck on a spinner', async () => {
    const options = (await loadComposable())();

    await options.load();

    expect(options.loading.value).toBe(false);
  });
});

describe('the remembered collection', () => {
  test('is read back from the last session', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'c-1', name: 'Vocab' }));
    const options = (await loadComposable())();

    options.restoreLastCollection();

    expect(options.lastCollection.value).toEqual({ id: 'c-1', name: 'Vocab' });
  });

  test('is remembered when the reader picks one', async () => {
    const options = (await loadComposable())();

    options.rememberLast({ id: 'c-2', name: 'Grammar' });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ id: 'c-2', name: 'Grammar' });
  });

  test('a hand-edited store just hides the shortcut', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const options = (await loadComposable())();

    options.restoreLastCollection();

    expect(options.lastCollection.value).toBeNull();
  });

  test('a stored value missing its name is ignored', async () => {
    // The name is what the shortcut is labelled with; an id alone would render
    // a button with no text on it.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'c-1' }));
    const options = (await loadComposable())();

    options.restoreLastCollection();

    expect(options.lastCollection.value).toBeNull();
  });

  test('is read back only once, however many cards ask', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'c-1', name: 'Vocab' }));
    const options = (await loadComposable())();
    options.restoreLastCollection();
    const spy = vi.spyOn(localStorage, 'getItem');

    options.restoreLastCollection();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('is DROPPED when the collection no longer exists', async () => {
    // It comes from localStorage and can name one the reader deleted on another
    // device; quick-adding into it would fail on every card.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'c-gone', name: 'Deleted' }));
    sdk.listCollections.mockResolvedValue({ collections: [collection('c-1', 'Vocab')] });
    const options = (await loadComposable())();
    options.restoreLastCollection();

    await options.load();

    expect(options.lastCollection.value).toEqual({ id: 'c-1', name: 'Vocab' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test('is kept when the collection is still there', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'c-2', name: 'Grammar' }));
    sdk.listCollections.mockResolvedValue({
      collections: [collection('c-1', 'Vocab'), collection('c-2', 'Grammar')],
    });
    const options = (await loadComposable())();
    options.restoreLastCollection();

    await options.load();

    expect(options.lastCollection.value).toEqual({ id: 'c-2', name: 'Grammar' });
  });

  test('defaults to the first collection when nothing was remembered', async () => {
    // So the quick-add shortcut works on a reader's first visit rather than
    // being hidden until they have used the full picker once.
    sdk.listCollections.mockResolvedValue({ collections: [collection('c-1', 'Vocab')] });
    const options = (await loadComposable())();

    await options.load();

    expect(options.lastCollection.value).toEqual({ id: 'c-1', name: 'Vocab' });
  });

  test('stays empty for a reader with no collections at all', async () => {
    const options = (await loadComposable())();

    await options.load();

    expect(options.lastCollection.value).toBeNull();
  });
});
