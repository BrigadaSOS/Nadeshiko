import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The list of titles a reader has hidden from their results.
 *
 * The stated risk is one-sided: "emptying this list is the one outcome worth
 * defending against, because it would hand the reader back every search result
 * they deliberately hid." So the reader of the stored shape is deliberately
 * tolerant, and every shape it has ever been written in has to keep working --
 * bare strings, `{ mediaPublicId }`, and the older rows that also carried names.
 *
 * The other half is the optimistic toggle. It updates the list before the server
 * has agreed and ROLLS BACK on failure, because leaving it would show a title as
 * hidden here while every other device, and the next page load, still shows it.
 */
const sdk = { addExcludedMedia: vi.fn(), removeExcludedMedia: vi.fn() };
const user = reactive({
  isLoggedIn: true,
  preferences: {} as Record<string, unknown>,
});

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

/** Re-imports the composable, which clears legacy storage once per session. */
async function loadComposable() {
  vi.resetModules();
  return (await import('./useHiddenMedia')).useHiddenMedia;
}

const media = { publicId: 'media-1', nameEn: 'Oshi no Ko' };

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  user.preferences = {};
  sdk.addExcludedMedia.mockResolvedValue({});
  sdk.removeExcludedMedia.mockResolvedValue({});
  localStorage.clear();
});

describe('reading the stored list', () => {
  test('reads the current shape', async () => {
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1' }] };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual(['media-1']);
  });

  test('reads a bare string, which is the shape this is meant to become', async () => {
    // A reader that already accepts it is what makes that a backend-only change.
    user.preferences = { hiddenMedia: ['media-1'] };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual(['media-1']);
  });

  test('reads an older row that still carries the names', async () => {
    // What an old container writes back during a deploy. Harmless, since only
    // the id is ever asked for.
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1', nameEn: 'Oshi no Ko', nameJa: '推しの子' }] };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual(['media-1']);
  });

  test('reads a list mixing every shape it has ever been written in', async () => {
    user.preferences = {
      hiddenMedia: ['media-1', { mediaPublicId: 'media-2' }, { mediaPublicId: 'media-3', nameEn: 'x' }],
    };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual(['media-1', 'media-2', 'media-3']);
  });

  test.each([
    ['an entry with no id', [{ nameEn: 'no id here' }]],
    ['a null entry', [null]],
    ['an empty string', ['']],
    ['a number', [42]],
  ])('drops %s without dropping the rest of the list', async (_name, junk) => {
    // Emptying the list would hand back every result the reader hid.
    user.preferences = { hiddenMedia: [...junk, { mediaPublicId: 'media-keep' }] };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual(['media-keep']);
  });

  test('is empty when the stored value is not a list at all', async () => {
    user.preferences = { hiddenMedia: 'not a list' };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual([]);
  });

  test('is empty for a signed-out reader', async () => {
    // The list lives on the account, so there is nothing to apply.
    user.isLoggedIn = false;
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1' }] };

    expect((await loadComposable())().hiddenMediaIds.value).toEqual([]);
  });

  test('answers whether one title is hidden', async () => {
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1' }] };
    const hidden = (await loadComposable())();

    expect(hidden.isMediaHidden('media-1')).toBe(true);
    expect(hidden.isMediaHidden('media-2')).toBe(false);
  });

  test('shapes the list as the search filter expects it', async () => {
    user.preferences = { hiddenMedia: ['media-1', 'media-2'] };

    expect((await loadComposable())().hiddenMediaExcludeFilter.value).toEqual([
      { mediaPublicId: 'media-1' },
      { mediaPublicId: 'media-2' },
    ]);
  });

  test('clears the key this list used to live under', async () => {
    // Hidden media moved to user preferences; the leftover key only needs
    // clearing once per session.
    localStorage.setItem('nadeshiko.hiddenMedia', '["media-old"]');

    (await loadComposable())();

    expect(localStorage.getItem('nadeshiko.hiddenMedia')).toBeNull();
  });
});

describe('hiding a title', () => {
  test('adds it and tells the server', async () => {
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(true);
    expect(hidden.hiddenMediaIds.value).toEqual(['media-1']);
    expect(sdk.addExcludedMedia).toHaveBeenCalledWith({ mediaPublicId: 'media-1' });
  });

  test('shows it as hidden before the server has answered', async () => {
    // The result cards disappear on the click rather than a round trip later.
    let release: (value: unknown) => void = () => {};
    sdk.addExcludedMedia.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const hidden = (await loadComposable())();

    const pending = hidden.toggleHideMedia(media);
    expect(hidden.hiddenMediaIds.value).toEqual(['media-1']);

    release({});
    await pending;
  });

  test('normalises the whole list as it writes, whatever shape it arrived in', async () => {
    // Rebuilt from the ids rather than spliced into the stored array.
    user.preferences = { hiddenMedia: ['media-old', { mediaPublicId: 'media-older', nameEn: 'x' }] };
    const hidden = (await loadComposable())();

    await hidden.toggleHideMedia(media);

    expect(user.preferences.hiddenMedia).toEqual([
      { mediaPublicId: 'media-old' },
      { mediaPublicId: 'media-older' },
      { mediaPublicId: 'media-1' },
    ]);
  });

  test('does nothing for a signed-out reader', async () => {
    user.isLoggedIn = false;
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(false);
    expect(sdk.addExcludedMedia).not.toHaveBeenCalled();
  });
});

describe('unhiding a title', () => {
  beforeEach(() => {
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1' }, { mediaPublicId: 'media-2' }] };
  });

  test('removes it and tells the server', async () => {
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(true);
    expect(hidden.hiddenMediaIds.value).toEqual(['media-2']);
    expect(sdk.removeExcludedMedia).toHaveBeenCalledWith({ mediaPublicId: 'media-1' });
  });

  test('leaves the other hidden titles alone', async () => {
    const hidden = (await loadComposable())();

    await hidden.toggleHideMedia(media);

    expect(hidden.isMediaHidden('media-2')).toBe(true);
  });
});

describe('when the change will not save', () => {
  beforeEach(() => {
    sdk.addExcludedMedia.mockRejectedValue(new Error('offline'));
    sdk.removeExcludedMedia.mockRejectedValue(new Error('offline'));
  });

  test('ROLLS BACK, rather than leaving a title hidden only here', async () => {
    // Leaving it would show the title as hidden while every other device, and
    // the next page load, still shows it.
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(false);
    expect(hidden.hiddenMediaIds.value).toEqual([]);
  });

  test('rolls an unhide back too', async () => {
    user.preferences = { hiddenMedia: [{ mediaPublicId: 'media-1' }] };
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(false);
    expect(hidden.hiddenMediaIds.value).toEqual(['media-1']);
  });

  test('tells the reader, and says which way the change was going', async () => {
    const hidden = (await loadComposable())();

    await hidden.toggleHideMedia(media);

    expect(handleApiError).toHaveBeenCalledWith(
      'hidden-media:toggle-failed',
      expect.anything(),
      expect.objectContaining({ context: { 'media.publicId': 'media-1', action: 'hide' } }),
    );
  });

  test('reports failure, so a caller can tell a saved change from an undone one', async () => {
    // Without the return value a caller cannot tell the two apart, and would
    // confirm a change that was rolled back under it.
    const hidden = (await loadComposable())();

    expect(await hidden.toggleHideMedia(media)).toBe(false);
  });
});

describe('re-running the search', () => {
  /** The counter the search watches to know the filter set moved. */
  function counter() {
    const useSharedState = (globalThis as unknown as Record<string, unknown>).useState as (
      key: string,
      init: () => number,
    ) => { value: number };
    return useSharedState('force-search-counter', () => 0);
  }

  test('bumps after a successful toggle', async () => {
    const hidden = (await loadComposable())();
    const before = counter().value;

    await hidden.toggleHideMedia(media);

    expect(counter().value).toBe(before + 1);
  });

  test('bumps after a ROLLED-BACK toggle too', async () => {
    // A rollback changes the list the search is drawn from just as much as a
    // successful toggle does, so the results have to be re-fetched either way.
    sdk.addExcludedMedia.mockRejectedValue(new Error('offline'));
    const hidden = (await loadComposable())();
    const before = counter().value;

    await hidden.toggleHideMedia(media);

    expect(counter().value).toBe(before + 1);
  });
});
