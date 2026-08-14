import { describe, it, expect, afterEach, vi } from 'vitest';
import { Media } from '@app/models';
import { normalizeLanguageFilter, resolveMediaFilterIds, resolvePreferredMediaIds } from '@app/controllers/searchFilters';
import { s_SearchFilters } from 'generated/schemas';
import type { t_SearchFilters } from 'generated/models';

type MediaInfoMap = Awaited<ReturnType<typeof Media.getMediaInfoMap>>;

function mockMediaInfoMap(entries: Array<[number, { publicId: string; anilist?: string }]>): void {
  const results = new Map(
    entries.map(([id, info]) => [id, { publicId: info.publicId, externalIds: { anilist: info.anilist ?? null } }]),
  );
  vi.spyOn(Media, 'getMediaInfoMap').mockResolvedValue({ results } as unknown as MediaInfoMap);
}

afterEach(() => {
  vi.spyOn(Media, 'getMediaInfoMap').mockRestore();
});

describe('normalizeLanguageFilter', () => {
  it('leaves an absent filter untouched', () => {
    const filters = { status: ['ACTIVE'] } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toBeUndefined();
  });

  it('tolerates undefined filters', () => {
    expect(() => normalizeLanguageFilter(undefined)).not.toThrow();
  });

  it('rewrites the legacy exclude form into the canonical include list', () => {
    const filters = { languages: { exclude: ['en'] } } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['ES']);
  });

  it('keeps the array form as an include list', () => {
    const filters = { languages: ['ES'] } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['ES']);
  });

  it('uppercases and drops unknown codes', () => {
    const filters = { languages: ['en', 'fr'] } as unknown as t_SearchFilters;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(['EN']);
  });

  it('is idempotent', () => {
    const filters = { languages: { exclude: ['es'] } } as t_SearchFilters;
    normalizeLanguageFilter(filters);
    const once = filters.languages;
    normalizeLanguageFilter(filters);
    expect(filters.languages).toEqual(once);
  });
});

describe('resolveMediaFilterIds', () => {
  it('does nothing without a media filter', async () => {
    const filters = { status: ['ACTIVE'] } as t_SearchFilters;
    const resolved = await resolveMediaFilterIds(filters);
    expect(resolved?.media).toBeUndefined();
  });

  it('resolves publicIds to internal media ids on include and exclude', async () => {
    mockMediaInfoMap([
      [7, { publicId: 'pub-seven' }],
      [9, { publicId: 'pub-nine' }],
    ]);

    const filters = {
      media: {
        include: [{ mediaPublicId: 'pub-seven' }],
        exclude: [{ mediaPublicId: 'pub-nine' }],
      },
    } as t_SearchFilters;

    const resolved = await resolveMediaFilterIds(filters);

    expect(resolved?.media?.include).toEqual([{ mediaPublicId: 'pub-seven', mediaId: 7 }] as never);
    expect(resolved?.media?.exclude).toEqual([{ mediaPublicId: 'pub-nine', mediaId: 9 }] as never);
  });

  it('falls back to matching the anilist external id', async () => {
    mockMediaInfoMap([[3, { publicId: 'pub-three', anilist: '12345' }]]);

    const filters = { media: { include: [{ mediaPublicId: '12345' }] } } as t_SearchFilters;
    const resolved = await resolveMediaFilterIds(filters);

    expect(resolved?.media?.include).toEqual([{ mediaPublicId: '12345', mediaId: 3 }] as never);
  });

  it('prefers a publicId over an anilist id that reads the same', async () => {
    mockMediaInfoMap([
      [3, { publicId: 'pub-three', anilist: 'shared-id' }],
      [4, { publicId: 'shared-id' }],
    ]);

    const filters = { media: { include: [{ mediaPublicId: 'shared-id' }] } } as t_SearchFilters;
    const resolved = await resolveMediaFilterIds(filters);

    expect(resolved?.media?.include).toEqual([{ mediaPublicId: 'shared-id', mediaId: 4 }] as never);
  });

  // Dropping the entry instead used to leave `include: []`, which reads downstream as
  // "no media filter" -- the narrowest possible request answered with the whole corpus.
  it('rejects an include entry naming a media that does not exist', async () => {
    mockMediaInfoMap([[7, { publicId: 'pub-seven' }]]);

    const filters = {
      media: { include: [{ mediaPublicId: 'pub-seven' }, { mediaPublicId: 'does-not-exist' }] },
    } as t_SearchFilters;

    await expect(resolveMediaFilterIds(filters)).rejects.toThrow(/does-not-exist/);
  });

  it('ignores an exclude entry naming a media that does not exist', async () => {
    mockMediaInfoMap([[7, { publicId: 'pub-seven' }]]);

    const filters = {
      media: { exclude: [{ mediaPublicId: 'pub-seven' }, { mediaPublicId: 'does-not-exist' }] },
    } as t_SearchFilters;

    const resolved = await resolveMediaFilterIds(filters);

    expect(resolved?.media?.exclude).toEqual([{ mediaPublicId: 'pub-seven', mediaId: 7 }] as never);
  });

  it('leaves the caller-supplied filters untouched', async () => {
    mockMediaInfoMap([[7, { publicId: 'pub-seven' }]]);

    const filters = { media: { include: [{ mediaPublicId: 'pub-seven' }] } } as t_SearchFilters;
    const resolved = await resolveMediaFilterIds(filters);

    expect(filters.media?.include).toEqual([{ mediaPublicId: 'pub-seven' }]);
    expect(resolved).not.toBe(filters);
  });
});

/**
 * `exclude` carries the reader's whole hidden-media list, so its ceiling is a limit on how
 * much a person may hide before search stops answering them. At 100 it was reachable: a
 * handful of readers crossed it and every search they made came back `400 Validation Failed`
 * while the same search worked logged out. `include` is a caller narrowing a request by hand
 * and does not grow on its own, which is why the two ceilings differ.
 */
describe('SearchFilters media ceilings', () => {
  // `mediaPublicId` is a fixed 12-character id, so the fixtures have to be well-formed
  // or the parse fails on the item shape and never reaches the ceiling being tested.
  const items = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ mediaPublicId: `media${String(i).padStart(7, '0')}` }));

  it('accepts a hidden-media list far past the old 100 limit', () => {
    expect(s_SearchFilters.safeParse({ media: { exclude: items(500) } }).success).toBe(true);
  });

  it('accepts an exclude list at the ceiling and rejects one past it', () => {
    expect(s_SearchFilters.safeParse({ media: { exclude: items(1000) } }).success).toBe(true);
    expect(s_SearchFilters.safeParse({ media: { exclude: items(1001) } }).success).toBe(false);
  });

  it('holds include to its own, smaller ceiling', () => {
    expect(s_SearchFilters.safeParse({ media: { include: items(100) } }).success).toBe(true);
    expect(s_SearchFilters.safeParse({ media: { include: items(101) } }).success).toBe(false);
  });

  it('resolves a large hidden-media list without dropping entries it can resolve', async () => {
    const hidden = items(400);
    // Every other one is a media that no longer exists -- an unhidden-by-deletion show is
    // ordinary for a list built up over months, and those are dropped rather than rejected.
    mockMediaInfoMap(hidden.filter((_, i) => i % 2 === 0).map((item, i) => [i + 1, { publicId: item.mediaPublicId }]));

    const resolved = await resolveMediaFilterIds({ media: { exclude: hidden } } as t_SearchFilters);

    expect(resolved?.media?.exclude).toHaveLength(200);
    expect(resolved?.media?.exclude?.[0]).toEqual({ mediaPublicId: 'media0000000', mediaId: 1 } as never);
  });
});

/**
 * Which requests are allowed to reorder their own ties, and which titles count.
 *
 * The mode check is the half that is easy to leave out: `preferMedia` is sent by
 * the web client on every search, including the ones where the reader has picked
 * an explicit order, and honouring it there would quietly answer a different
 * question than "by episode" or "at random".
 */
describe('resolvePreferredMediaIds', () => {
  it('resolves public ids to internal media ids', async () => {
    mockMediaInfoMap([
      [7, { publicId: 'aaaaaaaaaaaa' }],
      [9, { publicId: 'bbbbbbbbbbbb' }],
    ]);

    const ids = await resolvePreferredMediaIds(undefined, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);

    expect([...ids].sort()).toEqual([7, 9]);
  });

  it('drops ids naming a title that is no longer in the corpus', async () => {
    // A favourite outlives the media it points at, and the reader cannot be
    // expected to prune it. The title simply fails to be preferred.
    mockMediaInfoMap([[7, { publicId: 'aaaaaaaaaaaa' }]]);

    const ids = await resolvePreferredMediaIds({ mode: 'RELEVANCE' }, ['aaaaaaaaaaaa', 'zzzzzzzzzzzz']);

    expect([...ids]).toEqual([7]);
  });

  it('ignores the list under any sort the caller asked for by name', async () => {
    mockMediaInfoMap([[7, { publicId: 'aaaaaaaaaaaa' }]]);

    for (const mode of ['TIME_ASC', 'TIME_DESC', 'ASC', 'DESC', 'RANDOM']) {
      expect(await resolvePreferredMediaIds({ mode }, ['aaaaaaaaaaaa'])).toEqual(new Set());
    }
  });

  it('is empty when nothing was sent, without going to the media map', async () => {
    const mediaInfo = vi.spyOn(Media, 'getMediaInfoMap');

    expect(await resolvePreferredMediaIds({ mode: 'RELEVANCE' }, undefined)).toEqual(new Set());
    expect(await resolvePreferredMediaIds({ mode: 'RELEVANCE' }, [])).toEqual(new Set());
    expect(mediaInfo).not.toHaveBeenCalled();
  });
});
