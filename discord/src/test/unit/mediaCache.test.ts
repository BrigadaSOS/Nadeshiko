import { describe, test, expect, beforeEach, vi } from 'vitest';

const searchMedia = vi.fn();
vi.mock('../../api', () => ({ searchMedia: (...args: unknown[]) => searchMedia(...args) }));

import { searchMediaCache, findMediaByPublicId } from '../../mediaCache';

/**
 * The cache exists for one reason: Discord autocomplete sends the media's
 * public id, not its name, and the command that runs afterwards has to show a
 * name. Nothing re-fetches it -- if the id was never seen by an autocomplete
 * round-trip, the lookup misses and the reply loses the media title.
 */
function mediaItem(publicId: string, nameRomaji = publicId) {
  return { publicId, nameRomaji, nameEn: nameRomaji, nameJa: nameRomaji };
}

beforeEach(() => {
  searchMedia.mockReset();
  searchMedia.mockResolvedValue({ media: [] });
});

describe('searchMediaCache', () => {
  test('returns the matches the API found', async () => {
    searchMedia.mockResolvedValue({ media: [mediaItem('m-1', 'Oshi no Ko')] });

    const results = await searchMediaCache('oshi');

    expect(results.map((m) => m.publicId)).toEqual(['m-1']);
  });

  test('an empty query short-circuits without calling the API', async () => {
    // Discord fires an autocomplete request on the empty box before the user
    // types anything. Forwarding it is a request per keystroke-zero, per user.
    expect(await searchMediaCache('')).toEqual([]);
    expect(searchMedia).not.toHaveBeenCalled();
  });

  test('a whitespace-only query is treated as empty', async () => {
    expect(await searchMediaCache('   ')).toEqual([]);
    expect(searchMedia).not.toHaveBeenCalled();
  });

  test('caps results at the requested limit even if the API over-returns', async () => {
    // Discord rejects an autocomplete response with more than 25 choices, and
    // rejects the whole response -- the user sees no suggestions at all.
    searchMedia.mockResolvedValue({ media: Array.from({ length: 40 }, (_, i) => mediaItem(`m-${i}`)) });

    expect(await searchMediaCache('a', 25)).toHaveLength(25);
  });

  test('defaults to Discord’s 25-choice ceiling', async () => {
    await searchMediaCache('a');

    expect(searchMedia).toHaveBeenCalledWith('a', 25);
  });
});

describe('findMediaByPublicId', () => {
  test('resolves an id that a previous autocomplete round-trip saw', async () => {
    await searchMediaCache('oshi');
    searchMedia.mockResolvedValue({ media: [mediaItem('m-42', 'Oshi no Ko')] });
    await searchMediaCache('oshi');

    expect(findMediaByPublicId('m-42')?.nameRomaji).toBe('Oshi no Ko');
  });

  test('returns undefined for an id the cache never saw, rather than throwing', async () => {
    // A user can paste an id straight into the option box, skipping
    // autocomplete entirely. The command has to survive that.
    expect(findMediaByPublicId('m-never-seen')).toBeUndefined();
  });

  test('caches every item in a page, not just the ones returned under the limit', async () => {
    // The slice trims what Discord is shown; the cache keeps the rest, because
    // a later search for a longer prefix can still land on one of them.
    searchMedia.mockResolvedValue({ media: [mediaItem('m-a'), mediaItem('m-b'), mediaItem('m-c')] });

    await searchMediaCache('m', 1);

    expect(findMediaByPublicId('m-c')).toBeDefined();
  });
});
