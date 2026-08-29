import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

import { useHiddenCategories } from './useHiddenCategories';

/**
 * Whole-category hiding: a reader drops every live-action title or every YouTube
 * video at once, rather than naming shows one at a time.
 *
 * Two things here are worth defending. The first is the LAST VISIBLE guard:
 * `filters.category` reads an empty term list as "no filter", so hiding the last
 * category hands the reader back the entire corpus -- the exact opposite of what
 * they asked for, and the failure mode that made the guard necessary.
 *
 * The second is the optimistic toggle and its rollback. The switch flips before
 * the server has agreed, because waiting makes it feel broken; keeping the flip
 * after a failed write shows the category as hidden on this device while every
 * other one, and the next page load, still shows it.
 */
const sdk = { updateUserPreferences: vi.fn() };
const user = reactive({
  isLoggedIn: true,
  preferences: {} as Record<string, unknown> | null,
});

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

/** What the store ended up holding, which is what the next page load reads. */
const stored = () => (user.preferences as Record<string, unknown>)?.hiddenCategories;

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  user.preferences = {};
  sdk.updateUserPreferences.mockResolvedValue({});
});

describe('reading the stored list', () => {
  test('reads the categories the reader has hidden', () => {
    user.preferences = { hiddenCategories: ['ANIME'] };

    expect(useHiddenCategories().hiddenCategories.value).toEqual(['ANIME']);
  });

  test('a signed-out reader has none, whatever is left in the blob', () => {
    // Preferences belong to an account; a stale blob must not filter a
    // signed-out reader's search.
    user.isLoggedIn = false;
    user.preferences = { hiddenCategories: ['ANIME'] };

    expect(useHiddenCategories().hiddenCategories.value).toEqual([]);
  });

  test('a blob with nothing in it yet is empty, not broken', () => {
    user.preferences = {};

    expect(useHiddenCategories().hiddenCategories.value).toEqual([]);
  });

  test('a value that is not a list is ignored rather than crashing the search', () => {
    // Anything that ever wrote this key wrong takes the whole results page down
    // otherwise, since the filter is built on every request.
    user.preferences = { hiddenCategories: 'ANIME' };

    expect(useHiddenCategories().hiddenCategories.value).toEqual([]);
  });

  test('drops a category the corpus no longer has', () => {
    // Sending it back to the API is a 400 on every search, and the reader has
    // no way to see or clear the offending value.
    user.preferences = { hiddenCategories: ['ANIME', 'MANGA', 'YOUTUBE'] };

    expect(useHiddenCategories().hiddenCategories.value).toEqual(['ANIME', 'YOUTUBE']);
  });
});

describe('what is left visible', () => {
  test('is everything not hidden', () => {
    user.preferences = { hiddenCategories: ['ANIME'] };

    expect(useHiddenCategories().visibleCategories.value).toEqual(['JDRAMA', 'YOUTUBE']);
  });

  test('is the whole corpus when nothing is hidden', () => {
    expect(useHiddenCategories().visibleCategories.value).toEqual(['ANIME', 'JDRAMA', 'YOUTUBE']);
  });

  test('keeps tab order, so the tabs do not reshuffle as categories are hidden', () => {
    user.preferences = { hiddenCategories: ['JDRAMA'] };

    expect(useHiddenCategories().visibleCategories.value).toEqual(['ANIME', 'YOUTUBE']);
  });

  test('reports whether anything is hidden at all, which is what shows the notice', () => {
    expect(useHiddenCategories().hasHiddenCategories.value).toBe(false);

    user.preferences = { hiddenCategories: ['ANIME'] };
    expect(useHiddenCategories().hasHiddenCategories.value).toBe(true);
  });
});

describe('whether a switch can be flipped', () => {
  test('any category can be hidden while others remain', () => {
    expect(useHiddenCategories().canToggleCategory('ANIME')).toBe(true);
  });

  test('the LAST visible one cannot, since an empty filter means everything', () => {
    // Hiding it would hand back the whole corpus rather than nothing. The API
    // rejects it too; this keeps the UI from offering a click that only fails.
    user.preferences = { hiddenCategories: ['ANIME', 'JDRAMA'] };

    expect(useHiddenCategories().canToggleCategory('YOUTUBE')).toBe(false);
  });

  test('but an already-hidden one always can, so nobody is locked out', () => {
    // Otherwise a reader who hid two of three categories could never unhide
    // either of them.
    user.preferences = { hiddenCategories: ['ANIME', 'JDRAMA'] };

    expect(useHiddenCategories().canToggleCategory('ANIME')).toBe(true);
  });
});

describe('hiding a category', () => {
  test('stores it and tells the caller the change landed', async () => {
    const saved = await useHiddenCategories().toggleCategory('ANIME');

    expect(saved).toBe(true);
    expect(stored()).toEqual(['ANIME']);
    expect(sdk.updateUserPreferences).toHaveBeenCalledWith({ hiddenCategories: ['ANIME'] });
  });

  test('flips the switch BEFORE the server answers', async () => {
    // A switch that waits for a round trip reads as broken, and readers click
    // it again.
    let release = () => {};
    sdk.updateUserPreferences.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );

    const pending = useHiddenCategories().toggleCategory('ANIME');
    expect(stored()).toEqual(['ANIME']);

    release();
    await pending;
  });

  test('keeps the categories already hidden', async () => {
    // A toggle that replaced the list would silently un-hide everything else.
    user.preferences = { hiddenCategories: ['ANIME'] };

    await useHiddenCategories().toggleCategory('YOUTUBE');

    expect(stored()).toEqual(['ANIME', 'YOUTUBE']);
  });

  test('leaves the reader’s other preferences alone', async () => {
    // One blob holds all of them; a write that replaced it would drop the
    // reader's language and visibility settings.
    user.preferences = { theme: 'dark' };

    await useHiddenCategories().toggleCategory('ANIME');

    expect((user.preferences as Record<string, unknown>).theme).toBe('dark');
  });

  test('works from a blob that does not exist yet', async () => {
    // A brand-new account has no preferences object at all.
    user.preferences = null;

    expect(await useHiddenCategories().toggleCategory('ANIME')).toBe(true);
    expect(stored()).toEqual(['ANIME']);
  });
});

describe('unhiding a category', () => {
  test('takes it back out of the list', async () => {
    user.preferences = { hiddenCategories: ['ANIME', 'YOUTUBE'] };

    await useHiddenCategories().toggleCategory('ANIME');

    expect(stored()).toEqual(['YOUTUBE']);
  });

  test('removes it once, not every category', async () => {
    user.preferences = { hiddenCategories: ['ANIME', 'JDRAMA'] };

    await useHiddenCategories().toggleCategory('ANIME');

    expect(stored()).toEqual(['JDRAMA']);
  });
});

describe('a toggle nobody is allowed to make', () => {
  test('a signed-out reader changes nothing and calls nothing', async () => {
    user.isLoggedIn = false;

    expect(await useHiddenCategories().toggleCategory('ANIME')).toBe(false);
    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
  });

  test('the last visible category is refused before it reaches the API', async () => {
    user.preferences = { hiddenCategories: ['ANIME', 'JDRAMA'] };

    expect(await useHiddenCategories().toggleCategory('YOUTUBE')).toBe(false);
    expect(sdk.updateUserPreferences).not.toHaveBeenCalled();
    expect(stored()).toEqual(['ANIME', 'JDRAMA']);
  });
});

describe('a write that FAILED', () => {
  beforeEach(() => {
    sdk.updateUserPreferences.mockRejectedValue(new Error('offline'));
  });

  test('rolls the list back to what the server still holds', async () => {
    // Keeping it would show the category as hidden here while every other
    // device, and the next page load, still shows it.
    user.preferences = { hiddenCategories: ['ANIME'] };

    await useHiddenCategories().toggleCategory('YOUTUBE');

    expect(stored()).toEqual(['ANIME']);
  });

  test('rolls an UNHIDE back too, not just a hide', async () => {
    user.preferences = { hiddenCategories: ['ANIME'] };

    await useHiddenCategories().toggleCategory('ANIME');

    expect(stored()).toEqual(['ANIME']);
  });

  test('tells the caller it did not land, so nothing is announced', async () => {
    expect(await useHiddenCategories().toggleCategory('ANIME')).toBe(false);
  });

  test('reports it with the category and the direction it was going', async () => {
    // Which way the toggle was headed is most of the diagnosis, and it cannot
    // be recovered from the rolled-back state afterwards.
    await useHiddenCategories().toggleCategory('ANIME');

    expect(handleApiError).toHaveBeenCalledWith(
      'hidden-categories:toggle-failed',
      expect.anything(),
      expect.objectContaining({
        toastKey: 'hiddenCategories.updateError',
        context: { category: 'ANIME', action: 'hide' },
      }),
    );
  });

  test('and names an unhide as an unhide', async () => {
    user.preferences = { hiddenCategories: ['ANIME'] };

    await useHiddenCategories().toggleCategory('ANIME');

    expect(handleApiError.mock.calls[0]![2]).toMatchObject({ context: { action: 'unhide' } });
  });
});

describe('the results already on screen', () => {
  test('are re-fetched once the change lands', async () => {
    // The filter applies to the outgoing search, so results fetched a moment
    // ago still contain the category the reader just hid.
    const counter = useState('force-search-counter', () => 0);
    const before = counter.value;

    await useHiddenCategories().toggleCategory('ANIME');

    expect(counter.value).toBe(before + 1);
  });

  test('are left alone when the write failed', async () => {
    // Nothing changed, and a refetch would only cost the reader their place.
    sdk.updateUserPreferences.mockRejectedValue(new Error('offline'));
    const counter = useState('force-search-counter', () => 0);
    const before = counter.value;

    await useHiddenCategories().toggleCategory('ANIME');

    expect(counter.value).toBe(before);
  });
});
