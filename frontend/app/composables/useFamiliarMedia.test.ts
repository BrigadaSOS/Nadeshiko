import { describe, test, expect, beforeEach, vi } from 'vitest';
import { reactive } from 'vue';

/**
 * The ranking of titles a reader studies most, which orders the media filter.
 *
 * Held in `useState` so it rides the Nuxt payload: the search page loads it
 * server-side and hydration reproduces exactly the order the server rendered.
 * Fetching it from the component instead ordered the list alphabetically on the
 * server and re-sorted it a moment later in the browser -- a reshuffle under the
 * cursor of someone already reaching for a row.
 *
 * `load`'s RETURN VALUE is load-bearing for the same reason and is the part
 * worth pinning: `useAsyncData` writes it into the payload, and Nuxt reads
 * `undefined` there as "nothing cached" and re-runs the handler on the client.
 * So the empty array a signed-out reader gets is deliberately a value, and the
 * `undefined` after a failure is deliberately not -- the client SHOULD retry
 * that one rather than hydrate an empty ranking it would never correct.
 */
const sdk = { listFamiliarMedia: vi.fn(), forgetFamiliarMedia: vi.fn() };
const user = reactive({ isLoggedIn: true });

const handleApiError = vi.fn();
const reportError = vi.fn();
vi.mock('~/utils/apiError', () => ({ handleApiError: (...a: unknown[]) => handleApiError(...a) }));
vi.mock('~/utils/reportError', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

vi.stubGlobal('userStore', () => user);
vi.stubGlobal('useNadeshikoSdk', () => sdk);

import { useFamiliarMedia } from './useFamiliarMedia';

const entry = (publicId: string, score = 1) => ({
  media: { publicId, nameEn: publicId },
  score,
  ankiCount: 1,
  playCount: 0,
  shareCount: 0,
});

beforeEach(async () => {
  vi.clearAllMocks();
  user.isLoggedIn = true;
  sdk.listFamiliarMedia.mockResolvedValue({ familiarMedia: [] });
  sdk.forgetFamiliarMedia.mockResolvedValue({});
  // `useState` is shared by key for the whole run, so the ranking has to be
  // emptied between tests or one test's list is the next one's starting point.
  useFamiliarMedia().entries.value = [];
});

describe('loading the ranking', () => {
  test('stores what the server ranked', async () => {
    sdk.listFamiliarMedia.mockResolvedValue({ familiarMedia: [entry('media-1'), entry('media-2')] });
    const familiar = useFamiliarMedia();

    await familiar.load();

    expect(familiar.entries.value.map((e) => e.media.publicId)).toEqual(['media-1', 'media-2']);
  });

  test('RETURNS it too, which is what makes hydration a cache hit', async () => {
    // A handler returning nothing leaves `undefined` in the payload, Nuxt reads
    // that as "nothing cached", and the client re-fetches the ranking the
    // server had already put in the payload being hydrated.
    sdk.listFamiliarMedia.mockResolvedValue({ familiarMedia: [entry('media-1')] });

    const returned = await useFamiliarMedia().load();

    expect(returned?.map((e) => e.media.publicId)).toEqual(['media-1']);
  });

  test('a signed-out reader gets an empty ranking, and that is an ANSWER', async () => {
    // Not a failure: nobody is signed in, so there is no ranking, and it is
    // worth caching like any other result.
    user.isLoggedIn = false;

    const returned = await useFamiliarMedia().load();

    expect(returned).toEqual([]);
    expect(sdk.listFamiliarMedia).not.toHaveBeenCalled();
  });

  test('a payload with the key missing is an empty ranking, not a crash', async () => {
    sdk.listFamiliarMedia.mockResolvedValue({});

    expect(await useFamiliarMedia().load()).toEqual([]);
  });

  test('a null payload is too', async () => {
    sdk.listFamiliarMedia.mockResolvedValue(null);

    expect(await useFamiliarMedia().load()).toEqual([]);
  });
});

describe('a ranking that FAILED to load', () => {
  beforeEach(() => {
    sdk.listFamiliarMedia.mockRejectedValue(new Error('unauthorized'));
  });

  test('returns nothing, so the client retries rather than hydrating an empty list', async () => {
    // A server render that cannot authenticate for this owner-scoped route
    // lands here. Caching the empty ranking would leave the filter
    // alphabetical for the whole session with no way to correct it.
    expect(await useFamiliarMedia().load()).toBeUndefined();
  });

  test('leaves the filter with an empty ranking to fall back on', async () => {
    const familiar = useFamiliarMedia();

    await familiar.load();

    expect(familiar.entries.value).toEqual([]);
  });

  test('never raises a toast, because ordering is an enhancement', async () => {
    // An alphabetical filter is a perfectly good list; the reader has nothing
    // to do about this and does not need telling.
    await useFamiliarMedia().load();

    expect(reportError).toHaveBeenCalledWith('familiar-media:fetch-failed', expect.anything());
    expect(handleApiError).not.toHaveBeenCalled();
  });
});

describe('the rank the comparator reads', () => {
  test('is the position in the ranking, not the score', async () => {
    sdk.listFamiliarMedia.mockResolvedValue({
      familiarMedia: [entry('media-1', 90), entry('media-2', 40), entry('media-3', 10)],
    });
    const familiar = useFamiliarMedia();

    await familiar.load();

    expect(familiar.inferredRank.value.get('media-1')).toBe(0);
    expect(familiar.inferredRank.value.get('media-3')).toBe(2);
  });

  test('has nothing for a title the reader has never studied', async () => {
    const familiar = useFamiliarMedia();

    await familiar.load();

    expect(familiar.inferredRank.value.get('media-9')).toBeUndefined();
  });

  test('is a Map, which the comparator asks per row per keystroke', async () => {
    expect(useFamiliarMedia().inferredRank.value).toBeInstanceOf(Map);
  });
});

describe('forgetting one title', () => {
  test('drops the row as soon as the server answers', async () => {
    // Re-reading the whole ranking to drop one row would make this feel slower
    // than the clear beside it.
    sdk.listFamiliarMedia.mockResolvedValue({ familiarMedia: [entry('media-1'), entry('media-2')] });
    const familiar = useFamiliarMedia();
    await familiar.load();

    const forgotten = await familiar.forget('media-1');

    expect(forgotten).toBe(true);
    expect(sdk.forgetFamiliarMedia).toHaveBeenCalledWith({ mediaPublicId: 'media-1' });
    expect(familiar.entries.value.map((e) => e.media.publicId)).toEqual(['media-2']);
  });

  test('leaves the rest of the tally standing', async () => {
    // This is the per-row instrument; the bulk clear is the blunt one.
    sdk.listFamiliarMedia.mockResolvedValue({
      familiarMedia: [entry('media-1'), entry('media-2'), entry('media-3')],
    });
    const familiar = useFamiliarMedia();
    await familiar.load();

    await familiar.forget('media-2');

    expect(familiar.entries.value.map((e) => e.media.publicId)).toEqual(['media-1', 'media-3']);
  });

  test('a failure keeps the row and says so', async () => {
    // Dropping it anyway would show the title gone until the next load put it
    // back, which reads as the forget having silently undone itself.
    sdk.listFamiliarMedia.mockResolvedValue({ familiarMedia: [entry('media-1')] });
    const familiar = useFamiliarMedia();
    await familiar.load();
    sdk.forgetFamiliarMedia.mockRejectedValue(new Error('offline'));

    const forgotten = await familiar.forget('media-1');

    expect(forgotten).toBe(false);
    expect(familiar.entries.value).toHaveLength(1);
  });

  test('and a failure IS worth a toast, unlike the load', async () => {
    // The reader pressed a button and it did not happen; that is theirs to
    // know and to retry.
    sdk.forgetFamiliarMedia.mockRejectedValue(new Error('offline'));

    await useFamiliarMedia().forget('media-1');

    expect(handleApiError).toHaveBeenCalledWith(
      'familiar-media:forget-failed',
      expect.anything(),
      expect.objectContaining({ toastKey: 'familiarMedia.forgetError' }),
    );
  });
});
