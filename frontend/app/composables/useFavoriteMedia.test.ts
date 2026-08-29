import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

import { useFavoriteMedia, MAX_FAVORITE_MEDIA } from './useFavoriteMedia';

/**
 * The titles a reader has starred, which sort to the top of the media filter.
 *
 * Read straight from the user store so it is correct during SSR -- which is what
 * lets the filter be ordered server-side and stops it reshuffling under the
 * cursor after hydration.
 *
 * The toggle is optimistic with a rollback, like `useHiddenMedia`, and the cap
 * is the piece that is easy to get wrong in the other direction: it is checked
 * only to disable the control and say why, and it must never block an UNSTAR --
 * a reader who reached the ceiling would otherwise be unable to get back under
 * it.
 */
const sdk = { addFavoriteMedia: vi.fn(), removeFavoriteMedia: vi.fn() };
const user = reactive({
  isLoggedIn: true,
  preferences: {} as Record<string, unknown> | null,
});

const handleApiError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

const media = (publicId: string) => ({ publicId, nameEn: 'Oshi no Ko' });
const favorite = (mediaPublicId: string) => ({ mediaPublicId, favoritedAt: '2026-08-01T00:00:00Z' });
const stored = () => (user.preferences as Record<string, unknown>)?.favoriteMedia as { mediaPublicId: string }[];

beforeEach(() => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  user.preferences = {};
  sdk.addFavoriteMedia.mockResolvedValue({});
  sdk.removeFavoriteMedia.mockResolvedValue({});
});

describe('reading the starred list', () => {
  test('reads what the reader has starred', () => {
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    expect(useFavoriteMedia().isFavorite('media-1')).toBe(true);
  });

  test('a signed-out reader has none, and gets the plain alphabetical list', () => {
    user.isLoggedIn = false;
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    expect(useFavoriteMedia().items.value).toEqual([]);
  });

  test('a value that is not a list is ignored rather than breaking the filter', () => {
    user.preferences = { favoriteMedia: 'media-1' };

    expect(useFavoriteMedia().items.value).toEqual([]);
  });

  test('keeps an older entry that still carries the title names', () => {
    // Written before the lists were slimmed. Nothing reads the names, so the
    // entry is still usable and dropping it would unstar the title.
    user.preferences = {
      favoriteMedia: [{ mediaPublicId: 'media-1', favoritedAt: '2026-01-01T00:00:00Z', nameEn: 'Oshi no Ko' }],
    };

    expect(useFavoriteMedia().isFavorite('media-1')).toBe(true);
  });

  test.each([
    ['a bare string', 'media-1'],
    ['null', null],
    ['an entry with no id', { favoritedAt: '2026-01-01T00:00:00Z' }],
  ])('skips %s without taking the rest of the list with it', (_name, junk) => {
    // One malformed row must not cost the reader every star they have.
    user.preferences = { favoriteMedia: [junk, favorite('media-2')] };

    expect(useFavoriteMedia().items.value).toHaveLength(1);
    expect(useFavoriteMedia().isFavorite('media-2')).toBe(true);
  });

  test('offers the ids as a Set, which the sort comparator asks per row per keystroke', () => {
    user.preferences = { favoriteMedia: [favorite('media-1'), favorite('media-2')] };

    expect(useFavoriteMedia().favoriteMediaIds.value).toEqual(new Set(['media-1', 'media-2']));
  });
});

describe('starring a title', () => {
  test('stores it and reports that it landed', async () => {
    const saved = await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(saved).toBe(true);
    expect(sdk.addFavoriteMedia).toHaveBeenCalledWith({ mediaPublicId: 'media-1' });
    expect(stored().map((item) => item.mediaPublicId)).toEqual(['media-1']);
  });

  test('stars it BEFORE the server answers', async () => {
    // The star is on a row in a list the reader is scrolling; a round trip of
    // latency reads as a click that did not register.
    let release = () => {};
    sdk.addFavoriteMedia.mockReturnValue(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );

    const pending = useFavoriteMedia().toggleFavorite(media('media-1'));
    expect(stored()).toHaveLength(1);

    release();
    await pending;
  });

  test('stores only the id and a timestamp, not the names it was handed', async () => {
    // The names are no longer stored; the row is passed in because the star
    // has one in hand, not because it goes in the blob.
    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(Object.keys(stored()[0]!).sort()).toEqual(['favoritedAt', 'mediaPublicId']);
  });

  test('keeps the stars already there', async () => {
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    await useFavoriteMedia().toggleFavorite(media('media-2'));

    expect(stored().map((item) => item.mediaPublicId)).toEqual(['media-1', 'media-2']);
  });

  test('leaves the reader’s other preferences alone', async () => {
    user.preferences = { theme: 'dark' };

    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect((user.preferences as Record<string, unknown>).theme).toBe('dark');
  });

  test('a signed-out reader stars nothing and calls nothing', async () => {
    user.isLoggedIn = false;

    expect(await useFavoriteMedia().toggleFavorite(media('media-1'))).toBe(false);
    expect(sdk.addFavoriteMedia).not.toHaveBeenCalled();
  });
});

describe('unstarring', () => {
  test('removes it and calls the remove endpoint, not the add one', async () => {
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(sdk.removeFavoriteMedia).toHaveBeenCalledWith({ mediaPublicId: 'media-1' });
    expect(sdk.addFavoriteMedia).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  test('removes only that title', async () => {
    user.preferences = { favoriteMedia: [favorite('media-1'), favorite('media-2'), favorite('media-3')] };

    await useFavoriteMedia().toggleFavorite(media('media-2'));

    expect(stored().map((item) => item.mediaPublicId)).toEqual(['media-1', 'media-3']);
  });
});

describe('the cap', () => {
  const atCapPreferences = () => ({
    favoriteMedia: Array.from({ length: MAX_FAVORITE_MEDIA }, (_, i) => favorite(`media-${i}`)),
  });

  test('is reported so the control can be disabled and explained', () => {
    user.preferences = atCapPreferences();

    expect(useFavoriteMedia().atCap.value).toBe(true);
  });

  test('is not reported one short of it', () => {
    user.preferences = { favoriteMedia: Array.from({ length: MAX_FAVORITE_MEDIA - 1 }, (_, i) => favorite(`m-${i}`)) };

    expect(useFavoriteMedia().atCap.value).toBe(false);
  });

  test('refuses a new star and says why, rather than letting the server reject it', async () => {
    user.preferences = atCapPreferences();

    const saved = await useFavoriteMedia().toggleFavorite(media('one-too-many'));

    expect(saved).toBe(false);
    expect(sdk.addFavoriteMedia).not.toHaveBeenCalled();
    expect(handleApiError).toHaveBeenCalledWith(
      'favorite-media:cap-reached',
      expect.anything(),
      expect.objectContaining({ toastKey: 'favoriteMedia.capReached' }),
    );
  });

  test('still lets a reader UNSTAR at the cap, or they can never get back under it', async () => {
    // The cap check has to sit after the "is this already starred" question;
    // in front of it, a full list is a list nobody can edit.
    user.preferences = atCapPreferences();

    const saved = await useFavoriteMedia().toggleFavorite(media('media-0'));

    expect(saved).toBe(true);
    expect(sdk.removeFavoriteMedia).toHaveBeenCalled();
  });
});

describe('a write that FAILED', () => {
  beforeEach(() => {
    sdk.addFavoriteMedia.mockRejectedValue(new Error('offline'));
    sdk.removeFavoriteMedia.mockRejectedValue(new Error('offline'));
  });

  test('rolls the star back off', async () => {
    // Leaving it sorts the row to the top of a list every other device orders
    // differently.
    expect(await useFavoriteMedia().toggleFavorite(media('media-1'))).toBe(false);
    expect(stored()).toEqual([]);
  });

  test('rolls a failed UNSTAR back on', async () => {
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(stored().map((item) => item.mediaPublicId)).toEqual(['media-1']);
  });

  test('reports it with the title and the direction it was going', async () => {
    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(handleApiError).toHaveBeenCalledWith(
      'favorite-media:toggle-failed',
      expect.anything(),
      expect.objectContaining({
        toastKey: 'favoriteMedia.updateError',
        context: { 'media.publicId': 'media-1', action: 'favorite' },
      }),
    );
  });

  test('and names an unstar as an unstar', async () => {
    user.preferences = { favoriteMedia: [favorite('media-1')] };

    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(handleApiError.mock.calls[0]![2]).toMatchObject({ context: { action: 'unfavorite' } });
  });
});

describe('the search already on screen', () => {
  test('is NOT re-fetched, because starring changes order and not results', async () => {
    // Deliberately unlike `useHiddenMedia`: refiring here is a round trip for
    // an identical answer, and it costs the reader their place in the list.
    const counter = useState('force-search-counter', () => 0);
    const before = counter.value;

    await useFavoriteMedia().toggleFavorite(media('media-1'));

    expect(counter.value).toBe(before);
  });
});
