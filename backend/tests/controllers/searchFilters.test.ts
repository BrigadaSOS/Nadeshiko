import { describe, it, expect, afterEach, vi } from 'vitest';
import { Media } from '@app/models';
import { normalizeLanguageFilter, resolveMediaFilterIds } from '@app/controllers/searchFilters';
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
