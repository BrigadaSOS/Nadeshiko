import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAniListMediaMetadata } from '@app/services/roadmap/anilist';

afterEach(() => vi.restoreAllMocks());

describe('getAniListMediaMetadata', () => {
  it('loads a canonical title and cover for an AniList anime URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Media: {
              title: { english: 'Cowboy Bebop', romaji: 'Cowboy Bebop' },
              coverImage: {
                extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg',
              },
              siteUrl: 'https://anilist.co/anime/1',
            },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(getAniListMediaMetadata('https://anilist.co/anime/1/Cowboy-Bebop')).resolves.toEqual({
      title: 'Cowboy Bebop',
      coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg',
      siteUrl: 'https://anilist.co/anime/1',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).variables).toEqual({ id: 1 });
  });

  it('does not contact AniList for other URLs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await expect(getAniListMediaMetadata('https://myanimelist.net/anime/1')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open when the metadata request is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(getAniListMediaMetadata('https://anilist.co/anime/1')).resolves.toBeNull();
  });
});
